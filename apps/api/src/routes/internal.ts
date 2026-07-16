import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config";
import { db, schema } from "../db";
import { enqueueTranscription } from "../services/queue";
import {
  handleLiveAudioSocket,
  waitForRealtimeFinalization,
} from "../services/liveTranscription";

const statusSchema = z.object({
  status: z.enum([
    "joining",
    "waiting_admission",
    "recording",
    "uploading",
    "completed",
    "failed",
  ]),
  error: z.string().optional(),
});

const recordingSchema = z.object({
  objectKey: z.string().min(1),
  durationSec: z.number().int().nonnegative(),
});

const screenshotSchema = z.object({
  objectKey: z.string().min(1),
  capturedAtMs: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  hash: z.string().min(1),
});

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

export async function internalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    if (req.headers["x-internal-token"] !== config.internalToken) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/meetings/:id/live-audio", { websocket: true }, (ws, req) => {
    const { id } = req.params as { id: string };
    handleLiveAudioSocket(id, ws, req.log);
  });

  app.post("/meetings/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request body" });

    await db
      .update(schema.meetings)
      .set({
        status: parsed.data.status,
        error: parsed.data.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.meetings.id, id));
    await addStatusEvent(id, parsed.data.status, parsed.data.error);
    return { ok: true };
  });

  app.post("/meetings/:id/recording", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = recordingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request body" });

    // Simpan lokasi rekaman dulu, terpisah dari enqueue — kalau Redis down,
    // audioObjectKey tetap tercatat sehingga user bisa retry dari UI.
    await db
      .update(schema.meetings)
      .set({
        audioObjectKey: parsed.data.objectKey,
        durationSec: parsed.data.durationSec,
        containerId: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.meetings.id, id));
    await addStatusEvent(
      id,
      "recording_ready",
      `Recording uploaded (${parsed.data.durationSec}s)`,
    );

    const [meetingAfterUpload] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, id))
      .limit(1);
    const realtimeMeeting =
      meetingAfterUpload?.mode === "realtime" &&
      meetingAfterUpload.realtimeTranscriptStatus === "finalizing"
        ? await waitForRealtimeFinalization(id)
        : meetingAfterUpload;

    if (
      realtimeMeeting?.mode === "realtime" &&
      realtimeMeeting.realtimeTranscriptStatus === "completed"
    ) {
      await db
        .update(schema.meetings)
        .set({ status: "completed", error: null, updatedAt: new Date() })
        .where(eq(schema.meetings.id, id));
      await addStatusEvent(id, "completed", "Realtime transcript completed");
      return { ok: true };
    }

    if (
      realtimeMeeting?.mode === "realtime" &&
      realtimeMeeting.realtimeTranscriptStatus === "finalizing"
    ) {
      await db
        .update(schema.meetings)
        .set({
          realtimeTranscriptStatus: "failed",
          realtimeTranscriptError:
            "Realtime finalization timed out; queued post-meeting transcription",
          updatedAt: new Date(),
        })
        .where(eq(schema.meetings.id, id));
    }

    try {
      await enqueueTranscription(id, parsed.data.objectKey);
      // Worker yang memutuskan: transkripsi jalan (config ada di app_settings)
      // atau ditandai transcription_skipped.
      await db
        .update(schema.meetings)
        .set({ status: "processing_transcript", updatedAt: new Date() })
        .where(eq(schema.meetings.id, id));
      await addStatusEvent(id, "processing_transcript", "Transcription queued");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "failed to queue transcription");
      await db
        .update(schema.meetings)
        .set({
          status: "failed",
          error: `Unable to queue transcription: ${message}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.meetings.id, id));
      await addStatusEvent(id, "failed", `Unable to queue transcription: ${message}`);
    }
    return { ok: true };
  });

  app.post("/meetings/:id/screenshots", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = screenshotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request body" });

    const [screenshot] = await db
      .insert(schema.meetingScreenshots)
      .values({
        meetingId: id,
        objectKey: parsed.data.objectKey,
        capturedAtMs: parsed.data.capturedAtMs,
        width: parsed.data.width,
        height: parsed.data.height,
        hash: parsed.data.hash,
      })
      .returning();

    return { ok: true, screenshotId: screenshot.id };
  });
}
