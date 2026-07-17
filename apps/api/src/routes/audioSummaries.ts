import type { FastifyInstance } from "fastify";
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { randomUUID } from "node:crypto";
import { extname, parse } from "node:path";
import { z } from "zod";
import {
  TRANSCRIPTION_LANGUAGE_CODES,
  type TranscriptionLanguage,
} from "@openminutes/shared";
import { auth } from "../auth";
import { db, schema } from "../db";
import {
  deleteStoredObject,
  getStoredObject,
  putStoredObject,
} from "../services/storage";
import {
  enqueueSourceTranscription,
  enqueueSummary,
} from "../services/queue";
import { createSummaryVersion, listSummaryGroups } from "../services/summaries";

const MAX_AUDIO_UPLOAD_BYTES = 250 * 1024 * 1024;
const DEFAULT_TEMPLATE_KEY = "default";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(10),
  search: z.string().trim().max(200).optional().default(""),
  status: z
    .enum([
      "all",
      "pending",
      "processing_transcript",
      "completed",
      "transcription_skipped",
      "failed",
    ])
    .default("all"),
});

const summarizeSchema = z.object({
  templateKey: z.string().trim().min(1).max(60).default(DEFAULT_TEMPLATE_KEY),
});

function fieldValue(fields: Record<string, unknown>, key: string): string | null {
  const field = fields[key] as { value?: unknown } | undefined;
  return typeof field?.value === "string" ? field.value : null;
}

function titleFromFilename(filename: string): string {
  const name = parse(filename).name.replace(/[_-]+/g, " ").trim();
  return name || "Uploaded audio";
}

function sanitizeFilename(filename: string): string {
  const extension = extname(filename).toLowerCase();
  const base = parse(filename).name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "audio"}${extension || ".audio"}`;
}

function listWhere(userId: string, search: string, status: string) {
  const filters: SQL[] = [eq(schema.audioSummaries.userId, userId)];
  if (search) {
    const pattern = `%${search}%`;
    filters.push(
      or(
        ilike(schema.audioSummaries.title, pattern),
        ilike(schema.audioSummaries.originalFilename, pattern),
      )!,
    );
  }
  if (status !== "all") filters.push(eq(schema.audioSummaries.status, status));
  return and(...filters)!;
}

async function loadOwnedAudioSummary(userId: string, id: string) {
  const [audioSummary] = await db
    .select()
    .from(schema.audioSummaries)
    .where(
      and(eq(schema.audioSummaries.id, id), eq(schema.audioSummaries.userId, userId)),
    )
    .limit(1);
  return audioSummary ?? null;
}

export async function audioSummaryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    (req as any).user = session.user;
  });

  app.get("/audio-summaries", async (req, reply) => {
    const user = (req as any).user;
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }

    const { page, pageSize, search, status } = parsed.data;
    const where = listWhere(user.id, search, status);
    const [totalRows, totalAllRows, transcribingRows, completedRows] =
      await Promise.all([
        db.select({ value: count() }).from(schema.audioSummaries).where(where),
        db
          .select({ value: count() })
          .from(schema.audioSummaries)
          .where(eq(schema.audioSummaries.userId, user.id)),
        db
          .select({ value: count() })
          .from(schema.audioSummaries)
          .where(
            and(
              eq(schema.audioSummaries.userId, user.id),
              eq(schema.audioSummaries.status, "processing_transcript"),
            ),
          ),
        db
          .select({ value: count() })
          .from(schema.audioSummaries)
          .where(
            and(
              eq(schema.audioSummaries.userId, user.id),
              eq(schema.audioSummaries.status, "completed"),
            ),
          ),
      ]);

    const total = totalRows[0]?.value ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const items = await db
      .select()
      .from(schema.audioSummaries)
      .where(where)
      .orderBy(desc(schema.audioSummaries.createdAt))
      .limit(pageSize)
      .offset(offset);

    const ids = items.map((item) => item.id);
    const transcriptCounts = ids.length
      ? await db
          .select({
            audioSummaryId: schema.audioSummaryTranscriptSegments.audioSummaryId,
            value: count(),
          })
          .from(schema.audioSummaryTranscriptSegments)
          .where(inArray(schema.audioSummaryTranscriptSegments.audioSummaryId, ids))
          .groupBy(schema.audioSummaryTranscriptSegments.audioSummaryId)
      : [];
    const summaries = ids.length
      ? await db
          .select()
          .from(schema.summaries)
          .where(
            and(
              eq(schema.summaries.sourceType, "audio_summary"),
              inArray(schema.summaries.sourceId, ids),
              eq(schema.summaries.templateKey, DEFAULT_TEMPLATE_KEY),
            ),
          )
          .orderBy(desc(schema.summaries.version), desc(schema.summaries.createdAt))
      : [];

    const transcriptCountById = new Map(
      transcriptCounts.map((row) => [row.audioSummaryId, row.value]),
    );
    const summaryById = new Map<string, (typeof summaries)[number]>();
    for (const summary of summaries) {
      if (!summaryById.has(summary.sourceId)) {
        summaryById.set(summary.sourceId, summary);
      }
    }

    return {
      items: items.map((item) => ({
        ...item,
        transcriptCount: transcriptCountById.get(item.id) ?? 0,
        summary: summaryById.get(item.id) ?? null,
      })),
      total,
      page: currentPage,
      pageSize,
      totalPages,
      stats: {
        total: totalAllRows[0]?.value ?? 0,
        transcribing: transcribingRows[0]?.value ?? 0,
        completed: completedRows[0]?.value ?? 0,
      },
    };
  });

  app.post("/audio-summaries", async (req, reply) => {
    const user = (req as any).user;
    let file:
      | {
          filename: string;
          mimetype: string;
          buffer: Buffer;
        }
      | null = null;
    const fields: Record<string, unknown> = {};

    try {
      for await (const part of (req as any).parts({
        limits: { fileSize: MAX_AUDIO_UPLOAD_BYTES, files: 1 },
      })) {
        if (part.type === "file") {
          if (part.fieldname !== "file") {
            await part.file.resume();
            continue;
          }
          if (!part.mimetype?.startsWith("audio/")) {
            await part.file.resume();
            return reply.code(400).send({ error: "Only audio files are supported" });
          }
          file = {
            filename: part.filename || "audio",
            mimetype: part.mimetype,
            buffer: await part.toBuffer(),
          };
        } else {
          fields[part.fieldname] = { value: part.value };
        }
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(413).send({
          error: "Audio file is too large. Maximum upload size is 250 MB.",
        });
      }
      throw err;
    }

    if (!file) return reply.code(400).send({ error: "Audio file is required" });
    if (file.buffer.length > MAX_AUDIO_UPLOAD_BYTES) {
      return reply.code(413).send({
        error: "Audio file is too large. Maximum upload size is 250 MB.",
      });
    }

    const languageInput = fieldValue(fields, "language") ?? "id";
    const language = TRANSCRIPTION_LANGUAGE_CODES.includes(
      languageInput as TranscriptionLanguage,
    )
      ? (languageInput as TranscriptionLanguage)
      : "id";
    const title =
      fieldValue(fields, "title")?.trim().slice(0, 120) ||
      titleFromFilename(file.filename);
    const id = randomUUID();
    const objectKey = `audio-summaries/${id}/${sanitizeFilename(file.filename)}`;

    await putStoredObject(objectKey, file.buffer, file.mimetype);

    await db
      .insert(schema.audioSummaries)
      .values({
        id,
        userId: user.id,
        title,
        language,
        status: "processing_transcript",
        audioObjectKey: objectKey,
        originalFilename: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.buffer.length,
        updatedAt: new Date(),
      });

    try {
      await enqueueSourceTranscription({
        sourceType: "audio_summary",
        sourceId: id,
        objectKey,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.audioSummaries)
        .set({
          status: "failed",
          error: `Unable to queue transcription: ${message}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.audioSummaries.id, id));
    }

    const audioSummary = await loadOwnedAudioSummary(user.id, id);
    return reply.code(201).send({
      ...audioSummary,
      transcript: [],
      summary: null,
      summaries: [],
    });
  });

  app.get("/audio-summaries/:id", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const audioSummary = await loadOwnedAudioSummary(user.id, id);
    if (!audioSummary) return reply.code(404).send({ error: "Audio summary not found" });

    const transcript = await db
      .select()
      .from(schema.audioSummaryTranscriptSegments)
      .where(eq(schema.audioSummaryTranscriptSegments.audioSummaryId, id))
      .orderBy(asc(schema.audioSummaryTranscriptSegments.startMs));
    const summaries = await listSummaryGroups("audio_summary", id);
    const defaultSummary =
      summaries.find((group) => group.templateKey === DEFAULT_TEMPLATE_KEY)?.latest ??
      null;

    return {
      ...audioSummary,
      transcript,
      summary: defaultSummary,
      summaries,
    };
  });

  app.get("/audio-summaries/:id/audio", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const audioSummary = await loadOwnedAudioSummary(user.id, id);
    if (!audioSummary) return reply.code(404).send({ error: "Audio summary not found" });

    const object = await getStoredObject(audioSummary.audioObjectKey);
    if (!object) {
      return reply.code(404).send({ error: "Audio file was not found in storage" });
    }

    return reply
      .header("content-type", audioSummary.mimeType)
      .header("content-length", object.sizeBytes)
      .header(
        "content-disposition",
        `attachment; filename="${audioSummary.originalFilename}"`,
      )
      .send(object.stream);
  });

  app.post("/audio-summaries/:id/transcribe", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const audioSummary = await loadOwnedAudioSummary(user.id, id);
    if (!audioSummary) return reply.code(404).send({ error: "Audio summary not found" });

    const result = await enqueueSourceTranscription({
      sourceType: "audio_summary",
      sourceId: id,
      objectKey: audioSummary.audioObjectKey,
    });
    if (result === "already_running") {
      return reply.code(409).send({
        error: "Transcription is already queued and will run when processing is available",
      });
    }

    await db
      .update(schema.audioSummaries)
      .set({ status: "processing_transcript", error: null, updatedAt: new Date() })
      .where(eq(schema.audioSummaries.id, id));
    return { audioSummaryId: id, status: "processing_transcript" };
  });

  app.post("/audio-summaries/:id/summarize", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const parsed = summarizeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const audioSummary = await loadOwnedAudioSummary(user.id, id);
    if (!audioSummary) return reply.code(404).send({ error: "Audio summary not found" });

    const [{ value: transcriptCount }] = await db
      .select({ value: count() })
      .from(schema.audioSummaryTranscriptSegments)
      .where(eq(schema.audioSummaryTranscriptSegments.audioSummaryId, id));
    if ((transcriptCount ?? 0) === 0) {
      return reply.code(409).send({
        error: "Transcript is required before generating a summary",
      });
    }

    const summary = await createSummaryVersion({
      sourceType: "audio_summary",
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
        sourceType: "audio_summary",
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

    return { audioSummaryId: id, summaryId: summary.id, status: "processing" };
  });

  app.delete("/audio-summaries/:id", async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const audioSummary = await loadOwnedAudioSummary(user.id, id);
    if (!audioSummary) return reply.code(404).send({ error: "Audio summary not found" });

    await deleteStoredObject(audioSummary.audioObjectKey);
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.audioSummaryTranscriptSegments)
        .where(eq(schema.audioSummaryTranscriptSegments.audioSummaryId, id));
      await tx
        .delete(schema.summaries)
        .where(
          and(
            eq(schema.summaries.sourceType, "audio_summary"),
            eq(schema.summaries.sourceId, id),
          ),
        );
      await tx
        .delete(schema.audioSummaries)
        .where(
          and(
            eq(schema.audioSummaries.id, id),
            eq(schema.audioSummaries.userId, user.id),
          ),
        );
    });

    return { audioSummaryId: id, deleted: true };
  });
}
