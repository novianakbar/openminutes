import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, desc, asc, and, count, ilike, or, inArray, type SQL } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import {
  TRANSCRIPTION_LANGUAGE_CODES,
  detectPlatform,
  extractMeetingExternalId,
  generateMeetingTitle,
} from "@openminutes/shared";
import { auth } from "../auth";
import { db, schema } from "../db";
import { spawnBot, stopBot, isContainerGone } from "../services/botManager";
import {
  deleteRecording,
  deleteStoredObject,
  getStoredObject,
  getStoredObjectMetadata,
  getStoredObjectRange,
} from "../services/storage";
import { enqueueSummary, enqueueTranscription } from "../services/queue";
import {
  enqueueScheduledBot,
  removeScheduledBotJob,
} from "../services/scheduledBots";
import { createSummaryVersion, listSummaryGroups } from "../services/summaries";
import { mintViewToken, VIEW_TOKEN_TTL_SEC } from "../services/viewToken";
import { isLiveStatus } from "../services/vncProxy";
import { subscribeLiveTranscript } from "../services/liveTranscription";

const createBotSchema = z.object({
  meetingUrl: z.string().url(),
  title: z.string().trim().max(80).optional(),
  mode: z.enum(["post_meeting", "realtime"]).default("post_meeting"),
  language: z.enum(TRANSCRIPTION_LANGUAGE_CODES).default("id"),
  botName: z.string().min(1).max(60).default("OpenMinutes Assistant"),
  captureScreenshots: z.boolean().default(true),
  captureVideo: z.boolean().default(false),
  scheduledStartAt: z.string().datetime().optional(),
});

const scheduleMeetingSchema = z.object({
  scheduledStartAt: z.string().datetime(),
});

const listMeetingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(10),
  search: z.string().trim().max(200).optional().default(""),
  status: z
    .enum([
      "all",
      "active",
      "scheduled",
      "pending",
      "joining",
      "waiting_admission",
      "recording",
      "uploading",
      "processing_transcript",
      "completed",
      "transcription_skipped",
      "failed",
    ])
    .default("all"),
});

const screenshotParamsSchema = z.object({
  id: z.string().uuid(),
  screenshotId: z.coerce.number().int().positive(),
});

const summarizeSchema = z.object({
  templateKey: z.string().trim().min(1).max(60).default("default"),
});

const activeStatuses = ["joining", "waiting_admission", "recording"] as const;

type ParsedRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number; length: number }
  | { kind: "invalid" };

function parseRangeHeader(
  rangeHeader: string | string[] | undefined,
  totalSize: number,
): ParsedRange {
  if (!rangeHeader) return { kind: "full" };
  if (Array.isArray(rangeHeader)) return { kind: "invalid" };

  const range = rangeHeader.trim();
  if (range.includes(",")) return { kind: "invalid" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return { kind: "invalid" };

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { kind: "invalid" };
  if (totalSize <= 0) return { kind: "invalid" };

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (
      !Number.isSafeInteger(suffixLength) ||
      suffixLength <= 0
    ) {
      return { kind: "invalid" };
    }
    const length = Math.min(suffixLength, totalSize);
    const start = totalSize - length;
    return { kind: "partial", start, end: totalSize - 1, length };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) {
    return { kind: "invalid" };
  }

  let end = totalSize - 1;
  if (rawEnd) {
    const parsedEnd = Number(rawEnd);
    if (
      !Number.isSafeInteger(parsedEnd) ||
      parsedEnd < start
    ) {
      return { kind: "invalid" };
    }
    end = Math.min(parsedEnd, totalSize - 1);
  }

  return { kind: "partial", start, end, length: end - start + 1 };
}

function wantsDownload(query: unknown): boolean {
  return (query as { download?: string | string[] | undefined })?.download === "1";
}

async function sendStoredMedia(
  reply: FastifyReply,
  opts: {
    objectKey: string;
    rangeHeader: string | string[] | undefined;
    contentType: string;
    filename: string;
    download: boolean;
  },
): Promise<boolean> {
  const metadata = await getStoredObjectMetadata(opts.objectKey);
  if (!metadata) return false;

  const disposition = opts.download ? "attachment" : "inline";
  const contentDisposition = `${disposition}; filename="${opts.filename}"`;
  const totalSize = metadata.sizeBytes;
  const parsedRange = parseRangeHeader(opts.rangeHeader, totalSize);

  reply
    .header("accept-ranges", "bytes")
    .header("content-type", opts.contentType)
    .header("content-disposition", contentDisposition);

  if (parsedRange.kind === "invalid") {
    reply
      .code(416)
      .header("content-range", `bytes */${totalSize}`)
      .header("content-length", "0")
      .send();
    return true;
  }

  if (parsedRange.kind === "partial") {
    const stream = await getStoredObjectRange(
      opts.objectKey,
      parsedRange.start,
      parsedRange.length,
    );
    if (!stream) return false;
    reply
      .code(206)
      .header(
        "content-range",
        `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`,
      )
      .header("content-length", parsedRange.length)
      .send(stream);
    return true;
  }

  const object = await getStoredObject(opts.objectKey);
  if (!object) return false;
  reply
    .header("content-length", object.sizeBytes)
    .send(object.stream);
  return true;
}

async function addStatusEvent(
  meetingId: string,
  status: string,
  message?: string | null,
) {
  await db.insert(schema.meetingStatusEvents).values({
    meetingId,
    status,
    message: message ?? null,
  });
}

function listMeetingWhere(userId: string, search: string, status: string) {
  const filters: SQL[] = [eq(schema.meetings.userId, userId)];
  if (search) {
    const pattern = `%${search}%`;
    filters.push(
      or(
        ilike(schema.meetings.title, pattern),
        ilike(schema.meetings.externalMeetingId, pattern),
        ilike(schema.meetings.botName, pattern),
        ilike(schema.meetings.meetingUrl, pattern),
        ilike(schema.meetings.platform, pattern),
      )!,
    );
  }
  if (status === "active") {
    filters.push(inArray(schema.meetings.status, activeStatuses));
  } else if (status !== "all") {
    filters.push(eq(schema.meetings.status, status));
  }
  return and(...filters)!;
}

export async function botRoutes(app: FastifyInstance) {
  // getSession menerima cookie session maupun header x-api-key
  // (enableSessionForAPIKeys di auth.ts).
  app.addHook("preHandler", async (req, reply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    (req as any).user = session.user;
  });

  app.post("/bots", async (req, reply) => {
    const parsed = createBotSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const {
      meetingUrl,
      mode,
      language,
      botName,
      captureScreenshots,
      captureVideo,
    } = parsed.data;
    const scheduledStartAt = parsed.data.scheduledStartAt
      ? new Date(parsed.data.scheduledStartAt)
      : null;
    if (scheduledStartAt && scheduledStartAt.getTime() <= Date.now()) {
      return reply.code(400).send({
        error: "Scheduled start time must be in the future.",
      });
    }

    const platform = detectPlatform(meetingUrl);
    if (!platform) {
      return reply.code(400).send({
        error:
        "Unsupported meeting link. Supported platforms: Google Meet, Microsoft Teams, and Zoom.",
      });
    }
    const externalMeetingId = extractMeetingExternalId(meetingUrl, platform);
    if (!externalMeetingId) {
      return reply.code(400).send({
        error:
          "Meeting link is missing a meeting ID. Please use the full Google Meet, Microsoft Teams, or Zoom join link.",
      });
    }
    const title = parsed.data.title?.trim() || generateMeetingTitle(platform);

    const user = (req as any).user;
    const [meeting] = await db
      .insert(schema.meetings)
      .values({
        userId: user.id,
        title,
        platform,
        externalMeetingId,
        meetingUrl,
        mode,
        language,
        botName,
        captureScreenshots,
        captureVideo,
        status: scheduledStartAt ? "scheduled" : "pending",
        scheduledStartAt,
      })
      .returning();

    if (scheduledStartAt) {
      await addStatusEvent(
        meeting.id,
        "scheduled",
        `Meeting scheduled for ${scheduledStartAt.toISOString()}`,
      );
      try {
        await enqueueScheduledBot(meeting.id, scheduledStartAt);
        return reply.code(201).send({
          meetingId: meeting.id,
          title,
          externalMeetingId,
          status: "scheduled",
          platform,
          mode,
          language,
          scheduledStartAt: scheduledStartAt.toISOString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(schema.meetings)
          .set({ status: "failed", error: message, updatedAt: new Date() })
          .where(eq(schema.meetings.id, meeting.id));
        await addStatusEvent(meeting.id, "failed", message);
        req.log.error({ err }, "failed to schedule meeting session");
        return reply.code(502).send({
          meetingId: meeting.id,
          error: `Unable to schedule meeting session: ${message}`,
        });
      }
    }

    await addStatusEvent(meeting.id, "pending", "Meeting session created");

    try {
      const containerId = await spawnBot({
        meetingId: meeting.id,
        meetingUrl,
        platform,
        mode,
        botName,
        captureScreenshots,
        captureVideo,
      });
      await db
        .update(schema.meetings)
        .set({ containerId, status: "joining", updatedAt: new Date() })
        .where(eq(schema.meetings.id, meeting.id));
      await addStatusEvent(meeting.id, "joining", "OpenMinutes is joining the meeting");
      return reply
        .code(201)
        .send({
          meetingId: meeting.id,
          title,
          externalMeetingId,
          status: "joining",
          platform,
          mode,
          language,
        });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.meetings)
        .set({ status: "failed", error: message, updatedAt: new Date() })
        .where(eq(schema.meetings.id, meeting.id));
      await addStatusEvent(meeting.id, "failed", message);
      req.log.error({ err }, "failed to start meeting session");
      return reply
        .code(502)
        .send({ meetingId: meeting.id, error: `Unable to start meeting session: ${message}` });
    }
  });

  app.patch("/meetings/:id/schedule", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const parsed = scheduleMeetingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const scheduledStartAt = new Date(parsed.data.scheduledStartAt);
    if (scheduledStartAt.getTime() <= Date.now()) {
      return reply.code(400).send({
        error: "Scheduled start time must be in the future.",
      });
    }

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
    if (meeting.status !== "scheduled") {
      return reply
        .code(409)
        .send({ error: "Only scheduled meetings can be rescheduled" });
    }

    await db
      .update(schema.meetings)
      .set({ scheduledStartAt, updatedAt: new Date() })
      .where(eq(schema.meetings.id, id));
    await enqueueScheduledBot(id, scheduledStartAt);
    await addStatusEvent(
      id,
      "scheduled",
      `Meeting rescheduled for ${scheduledStartAt.toISOString()}`,
    );
    return {
      meetingId: id,
      status: "scheduled",
      scheduledStartAt: scheduledStartAt.toISOString(),
    };
  });

  app.get("/meetings", async (req, reply) => {
    const user = (req as any).user;
    const parsed = listMeetingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }

    const { page, pageSize, search, status } = parsed.data;
    const where = listMeetingWhere(user.id, search, status);

    const [totalRows, totalAllRows, activeRows, waitingRows, transcribingRows] =
      await Promise.all([
        db.select({ value: count() }).from(schema.meetings).where(where),
        db
          .select({ value: count() })
          .from(schema.meetings)
          .where(eq(schema.meetings.userId, user.id)),
        db
          .select({ value: count() })
          .from(schema.meetings)
          .where(
            and(
              eq(schema.meetings.userId, user.id),
              inArray(schema.meetings.status, activeStatuses),
            ),
          ),
        db
          .select({ value: count() })
          .from(schema.meetings)
          .where(
            and(
              eq(schema.meetings.userId, user.id),
              eq(schema.meetings.status, "waiting_admission"),
            ),
          ),
        db
          .select({ value: count() })
          .from(schema.meetings)
          .where(
            and(
              eq(schema.meetings.userId, user.id),
              eq(schema.meetings.status, "processing_transcript"),
            ),
          ),
      ]);

    const total = totalRows[0]?.value ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const items = await db
      .select()
      .from(schema.meetings)
      .where(where)
      .orderBy(desc(schema.meetings.createdAt))
      .limit(pageSize)
      .offset(offset);
    const meetingIds = items.map((item) => item.id);
    const transcriptCounts = meetingIds.length
      ? await db
          .select({
            meetingId: schema.transcriptSegments.meetingId,
            value: count(),
          })
          .from(schema.transcriptSegments)
          .where(inArray(schema.transcriptSegments.meetingId, meetingIds))
          .groupBy(schema.transcriptSegments.meetingId)
      : [];
    const transcriptCountByMeeting = new Map(
      transcriptCounts.map((row) => [row.meetingId, row.value]),
    );

    return {
      items: items.map((item) => ({
        ...item,
        transcriptCount: transcriptCountByMeeting.get(item.id) ?? 0,
      })),
      total,
      page: currentPage,
      pageSize,
      totalPages,
      stats: {
        total: totalAllRows[0]?.value ?? 0,
        active: activeRows[0]?.value ?? 0,
        waiting: waitingRows[0]?.value ?? 0,
        transcribing: transcribingRows[0]?.value ?? 0,
      },
    };
  });

  app.get("/meetings/all", async (req) => {
    const user = (req as any).user;
    return db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.userId, user.id))
      .orderBy(desc(schema.meetings.createdAt));
  });

  app.get("/meetings/:id", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    const segments = await db
      .select()
      .from(schema.transcriptSegments)
      .where(eq(schema.transcriptSegments.meetingId, id))
      .orderBy(schema.transcriptSegments.startMs);
    const events = await db
      .select()
      .from(schema.meetingStatusEvents)
      .where(eq(schema.meetingStatusEvents.meetingId, id))
      .orderBy(asc(schema.meetingStatusEvents.createdAt));
    const screenshots = await db
      .select()
      .from(schema.meetingScreenshots)
      .where(eq(schema.meetingScreenshots.meetingId, id))
      .orderBy(desc(schema.meetingScreenshots.capturedAtMs));
    const summaries = await listSummaryGroups("meeting", id);
    const defaultSummary =
      summaries.find((group) => group.templateKey === "default")?.latest ?? null;

    return {
      ...meeting,
      transcript: segments,
      events,
      screenshots,
      summary: defaultSummary,
      summaries,
    };
  });

  app.delete("/bots/:id", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
    if (!meeting.containerId) {
      return reply.code(409).send({ error: "The meeting session is not active" });
    }
    try {
      await stopBot(meeting.containerId);
    } catch (err) {
      if (isContainerGone(err)) {
        // Kontainer mati tanpa sempat lapor (mis. SIGKILL) — bersihkan state
        // yang nyangkut supaya meeting tidak selamanya terlihat aktif.
        await db
          .update(schema.meetings)
          .set({
            containerId: null,
            status: "failed",
            error: "The meeting session is no longer running",
            updatedAt: new Date(),
          })
          .where(eq(schema.meetings.id, id));
        await addStatusEvent(id, "failed", "The meeting session is no longer running");
        return { meetingId: id, status: "failed" };
      }
      throw err;
    }
    await addStatusEvent(id, "stop_requested", "Stop requested");
    return { meetingId: id, status: "stopping" };
  });

  // Hapus permanen: audio object di MinIO, transkrip, riwayat status, lalu
  // baris meeting. Dilarang saat masih in-progress supaya user paksa stop dulu
  // dan tidak menyisakan kontainer yatim.
  app.delete("/meetings/:id", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    const inProgress = [
      "pending",
      "joining",
      "waiting_admission",
      "recording",
      "uploading",
      "processing_transcript",
    ].includes(meeting.status);
    if (inProgress) {
      return reply.code(409).send({
        error:
          "Meeting is still in progress. Stop the session before deleting.",
      });
    }

    if (meeting.status === "scheduled") {
      await removeScheduledBotJob(id);
    }

    if (meeting.audioObjectKey) {
      await deleteRecording(meeting.audioObjectKey);
    }
    if (meeting.videoObjectKey) {
      await deleteStoredObject(meeting.videoObjectKey);
    }
    const screenshots = await db
      .select()
      .from(schema.meetingScreenshots)
      .where(eq(schema.meetingScreenshots.meetingId, id));
    await Promise.all(
      screenshots.map((screenshot) => deleteStoredObject(screenshot.objectKey)),
    );

    await db.transaction(async (tx) => {
      await tx
        .delete(schema.transcriptSegments)
        .where(eq(schema.transcriptSegments.meetingId, id));
      await tx
        .delete(schema.meetingScreenshots)
        .where(eq(schema.meetingScreenshots.meetingId, id));
      await tx
        .delete(schema.meetingStatusEvents)
        .where(eq(schema.meetingStatusEvents.meetingId, id));
      await tx
        .delete(schema.summaries)
        .where(
          and(
            eq(schema.summaries.sourceType, "meeting"),
            eq(schema.summaries.sourceId, id),
          ),
        );
      await tx
        .delete(schema.meetings)
        .where(
          and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
        );
    });

    return { meetingId: id, deleted: true };
  });

  app.get("/meetings/:id/screenshots/:screenshotId", async (req, reply) => {
    const user = (req as any).user;
    const parsed = screenshotParamsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid screenshot id" });
    const { id, screenshotId } = parsed.data;

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    const [screenshot] = await db
      .select()
      .from(schema.meetingScreenshots)
      .where(
        and(
          eq(schema.meetingScreenshots.id, screenshotId),
          eq(schema.meetingScreenshots.meetingId, id),
        ),
      )
      .limit(1);
    if (!screenshot) {
      return reply.code(404).send({ error: "Screenshot not found" });
    }

    const object = await getStoredObject(screenshot.objectKey);
    if (!object) {
      return reply.code(404).send({ error: "Screenshot file was not found in storage" });
    }

    return reply
      .header("content-type", object.contentType ?? "image/png")
      .header("content-length", object.sizeBytes)
      .header(
        "content-disposition",
        `inline; filename="meeting-${id}-screenshot-${screenshot.id}.png"`,
      )
      .send(object.stream);
  });

  // Transkripsi ulang / retry manual. Melayani semua jalur gagal: provider
  // belum dikonfigurasi (transcription_skipped), job gagal (failed), job
  // hilang dari Redis (nyangkut di processing_transcript), atau user ingin
  // memproses ulang meeting completed setelah ganti provider/bahasa.
  app.post("/meetings/:id/transcribe", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    if (isLiveStatus(meeting.status) || meeting.status === "uploading") {
      return reply
        .code(409)
        .send({ error: "Transcription starts automatically after the active recording is uploaded" });
    }
    if (!meeting.audioObjectKey) {
      return reply
        .code(409)
        .send({ error: "No recording is available for transcription" });
    }

    const result = await enqueueTranscription(id, meeting.audioObjectKey);
    if (result === "already_running") {
      // Job masih di antrean Redis (mis. worker sedang down) — akan diproses
      // otomatis begitu worker hidup, tidak perlu job baru.
      return reply.code(409).send({
        error:
          "Transcription is already queued and will run when processing is available",
      });
    }

    await db
      .update(schema.meetings)
      .set({ status: "processing_transcript", error: null, updatedAt: new Date() })
      .where(eq(schema.meetings.id, id));
    await addStatusEvent(id, "processing_transcript", "Transcription restarted");
    return { meetingId: id, status: "processing_transcript" };
  });

  app.post("/meetings/:id/summarize", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const parsed = summarizeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    const [{ value: transcriptCount }] = await db
      .select({ value: count() })
      .from(schema.transcriptSegments)
      .where(eq(schema.transcriptSegments.meetingId, id));
    if ((transcriptCount ?? 0) === 0) {
      return reply.code(409).send({
        error: "Transcript is required before generating a summary",
      });
    }

    const summary = await createSummaryVersion({
      sourceType: "meeting",
      sourceId: id,
      templateKey: parsed.data.templateKey,
      triggeredByUserId: user.id,
    });
    if (!summary) {
      return reply.code(404).send({ error: "Summary template not found or disabled" });
    }

    let result;
    try {
      result = await enqueueSummary({
        sourceType: "meeting",
        sourceId: id,
        templateKey: parsed.data.templateKey,
        summaryId: summary.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.summaries)
        .set({
          status: "failed",
          error: `Unable to queue summary: ${message}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.summaries.id, summary.id));
      return reply.code(502).send({ error: `Unable to queue summary: ${message}` });
    }
    if (result === "already_running") {
      return reply.code(409).send({
        error: "Summary generation is already queued",
      });
    }

    return { meetingId: id, summaryId: summary.id, status: "processing" };
  });

  // Token berumur pendek untuk membuka WS live view (docs/live-view-design.md §5.5).
  app.post("/meetings/:id/view-token", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
    if (!isLiveStatus(meeting.status) || !meeting.containerId) {
      return reply.code(409).send({ error: "The meeting session is not active" });
    }
    return {
      token: mintViewToken(meeting.id, user.id),
      expiresInSec: VIEW_TOKEN_TTL_SEC,
    };
  });

  app.get("/meetings/:id/transcript/live", { websocket: true }, async (ws, req) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) return ws.close(1008, "authentication_required");

    const { id } = req.params as { id: string };
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, session.user.id)),
      )
      .limit(1);
    if (!meeting) return ws.close(1008, "meeting_not_found");

    await subscribeLiveTranscript(meeting.id, ws);
  });

  app.get("/meetings/:id/audio", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
    if (!meeting.audioObjectKey) {
      return reply.code(404).send({ error: "Recording is not available yet" });
    }

    const sent = await sendStoredMedia(reply, {
      objectKey: meeting.audioObjectKey,
      rangeHeader: req.headers.range,
      contentType: "audio/ogg",
      filename: `meeting-${id}.ogg`,
      download: wantsDownload(req.query),
    });
    if (!sent) {
      return reply.code(404).send({ error: "Recording file was not found in storage" });
    }
    return reply;
  });

  app.get("/meetings/:id/video", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(eq(schema.meetings.id, id), eq(schema.meetings.userId, user.id)),
      )
      .limit(1);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
    if (!meeting.videoObjectKey) {
      return reply.code(404).send({ error: "Video recording is not available yet" });
    }

    const sent = await sendStoredMedia(reply, {
      objectKey: meeting.videoObjectKey,
      rangeHeader: req.headers.range,
      contentType: "video/mp4",
      filename: `meeting-${id}.mp4`,
      download: wantsDownload(req.query),
    });
    if (!sent) {
      return reply.code(404).send({ error: "Video file was not found in storage" });
    }
    return reply;
  });
}
