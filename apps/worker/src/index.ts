import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Client as MinioClient } from "minio";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
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

type TranscriptionSourceType = "meeting" | "audio_summary";
type SummarySourceType = "meeting" | "audio_summary";

interface TranscriptionJobData {
  sourceType?: TranscriptionSourceType;
  sourceId?: string;
  meetingId?: string;
  objectKey: string;
}

interface NormalizedTranscriptionJobData {
  sourceType: TranscriptionSourceType;
  sourceId: string;
  objectKey: string;
}

interface SummaryJobData {
  sourceType: SummarySourceType;
  sourceId: string;
  templateKey: string;
}

async function downloadAudio(objectKey: string): Promise<Buffer> {
  const stream = await minio.getObject(bucket, objectKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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

function normalizeTranscriptionJob(
  data: TranscriptionJobData,
): NormalizedTranscriptionJobData {
  return {
    sourceType: data.sourceType ?? "meeting",
    sourceId: data.sourceId ?? data.meetingId!,
    objectKey: data.objectKey,
  };
}

async function resolveTranscriptionLanguage(
  sourceType: TranscriptionSourceType,
  sourceId: string,
): Promise<string | null> {
  if (sourceType === "audio_summary") {
    const [audioSummary] = await db
      .select()
      .from(schema.audioSummaries)
      .where(eq(schema.audioSummaries.id, sourceId))
      .limit(1);
    return audioSummary?.language ?? null;
  }

  const [meeting] = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.id, sourceId))
    .limit(1);
  return meeting?.language ?? null;
}

async function markTranscriptionSkipped(
  sourceType: TranscriptionSourceType,
  sourceId: string,
) {
  if (sourceType === "audio_summary") {
    await db
      .update(schema.audioSummaries)
      .set({ status: "transcription_skipped", updatedAt: new Date() })
      .where(eq(schema.audioSummaries.id, sourceId));
    return;
  }

  await db
    .update(schema.meetings)
    .set({ status: "transcription_skipped", updatedAt: new Date() })
    .where(eq(schema.meetings.id, sourceId));
  await addStatusEvent(
    sourceId,
    "transcription_skipped",
    "Transcription provider is not configured",
  );
}

async function replaceTranscriptSegments(
  sourceType: TranscriptionSourceType,
  sourceId: string,
  segments: Array<{
    startMs: number;
    endMs: number;
    speaker: string | null;
    text: string;
  }>,
  rawCount: number,
) {
  if (sourceType === "audio_summary") {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.audioSummaryTranscriptSegments)
        .where(eq(schema.audioSummaryTranscriptSegments.audioSummaryId, sourceId));
      if (segments.length > 0) {
        await tx.insert(schema.audioSummaryTranscriptSegments).values(
          segments.map((segment) => ({
            audioSummaryId: sourceId,
            ...segment,
          })),
        );
      }
      await tx
        .update(schema.audioSummaries)
        .set({ status: "completed", error: null, updatedAt: new Date() })
        .where(eq(schema.audioSummaries.id, sourceId));
    });
    return;
  }

  // Hapus segmen lama dalam transaksi yang sama supaya job idempoten:
  // retry BullMQ setelah insert parsial tidak menduplikasi segmen, dan
  // transkripsi ulang manual mengganti hasil lama secara utuh.
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.transcriptSegments)
      .where(eq(schema.transcriptSegments.meetingId, sourceId));
    if (segments.length > 0) {
      await tx
        .insert(schema.transcriptSegments)
        .values(segments.map((s) => ({ meetingId: sourceId, ...s })));
    }
    await tx
      .update(schema.meetings)
      .set({ status: "completed", error: null, updatedAt: new Date() })
      .where(eq(schema.meetings.id, sourceId));
    await tx.insert(schema.meetingStatusEvents).values({
      meetingId: sourceId,
      status: "completed",
      message: `${segments.length} transcript segments created from ${rawCount} raw segments`,
    });
  });
}

async function markTranscriptionFailed(
  sourceType: TranscriptionSourceType,
  sourceId: string,
  message: string,
) {
  if (sourceType === "audio_summary") {
    await db
      .update(schema.audioSummaries)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(schema.audioSummaries.id, sourceId));
    return;
  }

  await db
    .update(schema.meetings)
    .set({ status: "failed", error: message, updatedAt: new Date() })
    .where(eq(schema.meetings.id, sourceId));
  await addStatusEvent(sourceId, "failed", message);
}

function transcriptToPrompt(
  segments: Array<{
    startMs: number;
    speaker: string | null;
    text: string;
  }>,
) {
  return segments
    .map((segment) => {
      const speaker = segment.speaker ? `${segment.speaker}: ` : "";
      return `[${formatTimestamp(segment.startMs)}] ${speaker}${segment.text}`;
    })
    .join("\n");
}

async function loadSummarySource(sourceType: SummarySourceType, sourceId: string) {
  if (sourceType === "audio_summary") {
    const [audioSummary] = await db
      .select()
      .from(schema.audioSummaries)
      .where(eq(schema.audioSummaries.id, sourceId))
      .limit(1);
    if (!audioSummary) throw new Error("Audio summary source was not found");
    const transcript = await db
      .select()
      .from(schema.audioSummaryTranscriptSegments)
      .where(eq(schema.audioSummaryTranscriptSegments.audioSummaryId, sourceId))
      .orderBy(schema.audioSummaryTranscriptSegments.startMs);
    return {
      title: audioSummary.title,
      language: audioSummary.language,
      transcript,
    };
  }

  const [meeting] = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.id, sourceId))
    .limit(1);
  if (!meeting) throw new Error("Meeting source was not found");
  const transcript = await db
    .select()
    .from(schema.transcriptSegments)
    .where(eq(schema.transcriptSegments.meetingId, sourceId))
    .orderBy(schema.transcriptSegments.startMs);
  return {
    title: meeting.title,
    language: meeting.language,
    transcript,
  };
}

async function generateSummaryWithOpenAICompatible(opts: {
  title: string;
  language: string;
  transcript: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}) {
  const transcript =
    opts.transcript.length > 80_000
      ? `${opts.transcript.slice(0, 80_000)}\n\n[Transcript truncated for summary generation]`
      : opts.transcript;
  const response = await fetch(
    `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You create concise, useful meeting/audio summaries. Return markdown only.",
          },
          {
            role: "user",
            content: [
              `Title: ${opts.title}`,
              `Summary language: ${opts.language}`,
              "",
              "Create a simple summary with these sections:",
              "## Ringkasan",
              "## Poin Penting",
              "## Action Items",
              "",
              "If action items are not explicit, write '- Tidak ada action item eksplisit.'",
              "",
              "Transcript:",
              transcript,
            ].join("\n"),
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Summary provider returned ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Summary provider returned an empty response");
  return content;
}

async function markSummaryFailed(data: SummaryJobData, message: string) {
  await db
    .update(schema.summaries)
    .set({ status: "failed", error: message, updatedAt: new Date() })
    .where(
      and(
        eq(schema.summaries.sourceType, data.sourceType),
        eq(schema.summaries.sourceId, data.sourceId),
        eq(schema.summaries.templateKey, data.templateKey),
      ),
    );
}

const transcriptionWorker = new Worker<TranscriptionJobData>(
  "transcription",
  async (job) => {
    const { sourceType, sourceId, objectKey } = normalizeTranscriptionJob(job.data);

    const provider = await resolveProvider(
      await resolveTranscriptionLanguage(sourceType, sourceId),
    );
    if (!provider) {
      console.warn(
        `[${sourceType}:${sourceId}] transcription belum dikonfigurasi (app_settings/env) — dilewati`,
      );
      await markTranscriptionSkipped(sourceType, sourceId);
      return;
    }

    console.log(
      `[${sourceType}:${sourceId}] mulai transkripsi ${objectKey} via ${provider.name}`,
    );
    const audio = await downloadAudio(objectKey);
    const rawSegments = await provider.transcribe(audio);
    const segments = groupTranscriptSegments(rawSegments);

    await replaceTranscriptSegments(
      sourceType,
      sourceId,
      segments,
      rawSegments.length,
    );
    console.log(
      `[${sourceType}:${sourceId}] selesai: ${segments.length} segmen (${rawSegments.length} raw)`,
    );
  },
  { connection, concurrency: 2 },
);

transcriptionWorker.on("failed", async (job, err) => {
  console.error(`Job ${job?.id} gagal:`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    const data = normalizeTranscriptionJob(job.data);
    await markTranscriptionFailed(data.sourceType, data.sourceId, err.message);
  }
});

const summaryWorker = new Worker<SummaryJobData>(
  "summary",
  async (job) => {
    const { sourceType, sourceId, templateKey } = job.data;
    const [settings] = await db.select().from(schema.summarySettings).limit(1);
    if (!settings?.baseUrl || !settings.model) {
      throw new Error("AI summary provider is not configured");
    }

    const source = await loadSummarySource(sourceType, sourceId);
    if (source.transcript.length === 0) {
      throw new Error("Transcript is not available for summary generation");
    }

    const content = await generateSummaryWithOpenAICompatible({
      title: source.title,
      language: source.language,
      transcript: transcriptToPrompt(source.transcript),
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    });

    await db
      .insert(schema.summaries)
      .values({
        sourceType,
        sourceId,
        templateKey,
        status: "completed",
        content,
        model: settings.model,
        error: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.summaries.sourceType,
          schema.summaries.sourceId,
          schema.summaries.templateKey,
        ],
        set: {
          status: "completed",
          content,
          model: settings.model,
          error: null,
          updatedAt: new Date(),
        },
      });
  },
  { connection, concurrency: 1 },
);

summaryWorker.on("failed", async (job, err) => {
  console.error(`Summary job ${job?.id} gagal:`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await markSummaryFailed(job.data, err.message);
  }
});

console.log("Worker transkripsi dan summary berjalan, menunggu job…");
