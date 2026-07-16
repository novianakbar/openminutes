import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Client as MinioClient } from "minio";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { groupTranscriptSegments } from "@openminutes/shared";
import * as schema from "@openminutes/shared/schema";
import { deepgramProvider } from "./providers/deepgram";
import { openaiCompatibleProvider } from "./providers/openaiCompatible";
import type { TranscriptionProvider } from "./providers/types";

const env = (key: string, fallback: string) => process.env[key] ?? fallback;

const databaseUrl = env(
  "DATABASE_URL",
  "postgres://openminutes:openminutes@localhost:5432/openminutes",
);
const redisUrl = env("REDIS_URL", "redis://localhost:6379");
const bucket = env("MINIO_BUCKET", "recordings");

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });

const minio = new MinioClient({
  endPoint: env("MINIO_ENDPOINT", "localhost"),
  port: Number(env("MINIO_PORT", "9000")),
  useSSL: false,
  accessKey: env("MINIO_ACCESS_KEY", "minio"),
  secretKey: env("MINIO_SECRET_KEY", "minio12345"),
});

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

async function downloadAudio(objectKey: string): Promise<Buffer> {
  const stream = await minio.getObject(bucket, objectKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// Config dibaca dari app_settings tiap job supaya perubahan dari UI admin
// langsung berlaku tanpa restart worker. Env var jadi fallback saat baris
// settings belum ada / API key-nya kosong.
async function resolveProvider(
  languageOverride?: string | null,
): Promise<TranscriptionProvider | null> {
  const [row] = await db.select().from(schema.appSettings).limit(1);
  const language = languageOverride ?? row?.language ?? env("DEEPGRAM_LANGUAGE", "id");

  if (row?.provider === "openai_compatible") {
    if (!row.baseUrl) return null;
    return openaiCompatibleProvider({
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
      model: row.model,
      language,
    });
  }

  const deepgramKey = row?.apiKey || process.env.DEEPGRAM_API_KEY;
  if (!deepgramKey) return null;
  return deepgramProvider({ apiKey: deepgramKey, model: row?.model, language });
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

const worker = new Worker<{ meetingId: string; objectKey: string }>(
  "transcription",
  async (job) => {
    const { meetingId, objectKey } = job.data;
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, meetingId))
      .limit(1);

    const provider = await resolveProvider(meeting?.language);
    if (!provider) {
      console.warn(
        `[${meetingId}] transcription belum dikonfigurasi (app_settings/env) — dilewati`,
      );
      await db
        .update(schema.meetings)
        .set({ status: "transcription_skipped", updatedAt: new Date() })
        .where(eq(schema.meetings.id, meetingId));
      await addStatusEvent(
        meetingId,
        "transcription_skipped",
        "Transcription provider is not configured",
      );
      return;
    }

    console.log(
      `[${meetingId}] mulai transkripsi ${objectKey} via ${provider.name}`,
    );
    const audio = await downloadAudio(objectKey);
    const rawSegments = await provider.transcribe(audio);
    const segments = groupTranscriptSegments(rawSegments);

    // Hapus segmen lama dalam transaksi yang sama supaya job idempoten:
    // retry BullMQ setelah insert parsial tidak menduplikasi segmen, dan
    // transkripsi ulang manual mengganti hasil lama secara utuh.
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.transcriptSegments)
        .where(eq(schema.transcriptSegments.meetingId, meetingId));
      if (segments.length > 0) {
        await tx
          .insert(schema.transcriptSegments)
          .values(segments.map((s) => ({ meetingId, ...s })));
      }
      await tx
        .update(schema.meetings)
        .set({ status: "completed", error: null, updatedAt: new Date() })
        .where(eq(schema.meetings.id, meetingId));
      await tx.insert(schema.meetingStatusEvents).values({
        meetingId,
        status: "completed",
        message: `${segments.length} transcript segments created from ${rawSegments.length} raw segments`,
      });
    });
    console.log(
      `[${meetingId}] selesai: ${segments.length} segmen (${rawSegments.length} raw)`,
    );
  },
  { connection, concurrency: 2 },
);

worker.on("failed", async (job, err) => {
  console.error(`Job ${job?.id} gagal:`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await db
      .update(schema.meetings)
      .set({ status: "failed", error: err.message, updatedAt: new Date() })
      .where(eq(schema.meetings.id, job.data.meetingId));
    await addStatusEvent(job.data.meetingId, "failed", err.message);
  }
});

console.log("Worker transkripsi berjalan, menunggu job…");
