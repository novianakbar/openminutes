import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import { eq, asc } from "drizzle-orm";
import WebSocket, { type RawData } from "ws";
import type { FastifyBaseLogger } from "fastify";
import {
  groupTranscriptSegments,
  type RealtimeTranscriptStatus,
} from "@openminutes/shared";
import { db, schema } from "../db";

const PCM_SAMPLE_RATE = 16_000;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE;
const COMPATIBLE_WINDOW_MS = 10_000;
const COMPATIBLE_WINDOW_BYTES =
  (PCM_BYTES_PER_SECOND * COMPATIBLE_WINDOW_MS) / 1000;

type TranscriptSegmentRow = typeof schema.transcriptSegments.$inferSelect;
type MeetingRow = typeof schema.meetings.$inferSelect;

interface SegmentInput {
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
}

interface LivePartialSegment extends SegmentInput {
  meetingId: string;
}

type LiveTranscriptEvent =
  | { type: "snapshot"; segments: TranscriptSegmentRow[] }
  | { type: "partial"; segment: LivePartialSegment }
  | { type: "final"; segment: TranscriptSegmentRow }
  | {
      type: "status";
      status: RealtimeTranscriptStatus;
      message?: string | null;
    }
  | { type: "error"; message: string };

interface LiveProcessor {
  sendAudio(chunk: Buffer): void;
  finish(): Promise<void>;
  abort(): void;
}

interface ResolvedProvider {
  provider: "deepgram" | "openai_compatible";
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  language: string;
}

const subscribers = new Map<string, Set<WebSocket>>();

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(meetingId: string, event: LiveTranscriptEvent): void {
  const clients = subscribers.get(meetingId);
  if (!clients) return;
  for (const client of clients) sendJson(client, event);
}

function asBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function pcmDurationMs(byteLength: number): number {
  return Math.round((byteLength / PCM_BYTES_PER_SECOND) * 1000);
}

function makeWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE;
  const blockAlign = PCM_BYTES_PER_SAMPLE;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

function parseJson(data: RawData): unknown {
  try {
    return JSON.parse(asBuffer(data).toString("utf8"));
  } catch {
    return null;
  }
}

async function resolveProvider(meetingId: string): Promise<ResolvedProvider | null> {
  const [[row], [meeting]] = await Promise.all([
    db.select().from(schema.appSettings).limit(1),
    db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, meetingId))
      .limit(1),
  ]);
  const language =
    meeting?.language ?? row?.language ?? process.env.DEEPGRAM_LANGUAGE ?? "id";

  if (row?.provider === "openai_compatible") {
    if (!row.baseUrl) return null;
    return {
      provider: "openai_compatible",
      apiKey: row.apiKey,
      baseUrl: row.baseUrl,
      model: row.model,
      language,
    };
  }

  const apiKey = row?.apiKey || process.env.DEEPGRAM_API_KEY || null;
  if (!apiKey) return null;
  return {
    provider: "deepgram",
    apiKey,
    baseUrl: null,
    model: row?.model ?? null,
    language,
  };
}

async function updateRealtimeStatus(
  meetingId: string,
  status: RealtimeTranscriptStatus,
  error?: string | null,
): Promise<void> {
  await db
    .update(schema.meetings)
    .set({
      realtimeTranscriptStatus: status,
      realtimeTranscriptError: error ?? null,
      realtimeFinalizedAt: status === "completed" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.meetings.id, meetingId));
  broadcast(meetingId, { type: "status", status, message: error ?? null });
}

async function insertFinalSegment(
  meetingId: string,
  segment: SegmentInput,
): Promise<TranscriptSegmentRow | null> {
  const text = segment.text.trim();
  if (!text) return null;

  const [row] = await db
    .insert(schema.transcriptSegments)
    .values({
      meetingId,
      startMs: Math.max(0, segment.startMs),
      endMs: Math.max(segment.startMs, segment.endMs),
      speaker: segment.speaker,
      text,
    })
    .returning();
  if (row) broadcast(meetingId, { type: "final", segment: row });
  return row ?? null;
}

class TranscriptSegmentAccumulator {
  private current: SegmentInput | null = null;

  constructor(
    private readonly meetingId: string,
    private readonly flushSegment: (segment: SegmentInput) => Promise<void>,
  ) {}

  async add(segment: SegmentInput): Promise<void> {
    const text = segment.text.trim();
    if (!text) return;
    const normalized = { ...segment, text };

    if (!this.current) {
      this.current = normalized;
      this.broadcastCurrent();
      return;
    }

    const grouped = groupTranscriptSegments([this.current, normalized]);
    if (grouped.length === 1) {
      this.current = grouped[0];
      this.broadcastCurrent();
      return;
    }

    await this.flush();
    this.current = normalized;
    this.broadcastCurrent();
  }

  async flush(): Promise<void> {
    if (!this.current) return;
    const segment = this.current;
    this.current = null;
    await this.flushSegment(segment);
  }

  clear(): void {
    this.current = null;
  }

  private broadcastCurrent(): void {
    if (!this.current) return;
    broadcast(this.meetingId, {
      type: "partial",
      segment: { meetingId: this.meetingId, ...this.current },
    });
  }
}

export async function subscribeLiveTranscript(
  meetingId: string,
  ws: WebSocket,
): Promise<void> {
  const segments = await db
    .select()
    .from(schema.transcriptSegments)
    .where(eq(schema.transcriptSegments.meetingId, meetingId))
    .orderBy(asc(schema.transcriptSegments.startMs));

  sendJson(ws, { type: "snapshot", segments } satisfies LiveTranscriptEvent);

  let clients = subscribers.get(meetingId);
  if (!clients) {
    clients = new Set();
    subscribers.set(meetingId, clients);
  }
  clients.add(ws);

  const cleanup = () => {
    clients?.delete(ws);
    if (clients?.size === 0) subscribers.delete(meetingId);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

class DeepgramLiveProcessor implements LiveProcessor {
  private readonly ws: WebSocket;
  private readonly finalKeys = new Set<string>();
  private closed = false;

  static async create(
    opts: ResolvedProvider,
    onPartial: (segment: SegmentInput) => void,
    onFinal: (segment: SegmentInput) => Promise<void>,
    onError: (err: Error) => void,
  ): Promise<DeepgramLiveProcessor> {
    if (!opts.apiKey) throw new Error("Deepgram API key is not configured");

    const params = new URLSearchParams({
      model: opts.model || "nova-2",
      language: opts.language,
      smart_format: "true",
      interim_results: "true",
      encoding: "linear16",
      sample_rate: String(PCM_SAMPLE_RATE),
      channels: "1",
      diarize_model: "latest",
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${opts.apiKey}` },
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.off("error", onErrorOpen);
        ws.off("close", onCloseOpen);
        resolve();
      };
      const onErrorOpen = (err: Error) => {
        ws.off("open", onOpen);
        ws.off("close", onCloseOpen);
        reject(err);
      };
      const onCloseOpen = () => {
        ws.off("open", onOpen);
        ws.off("error", onErrorOpen);
        reject(new Error("Deepgram realtime connection closed before opening"));
      };
      ws.once("open", onOpen);
      ws.once("error", onErrorOpen);
      ws.once("close", onCloseOpen);
    });

    return new DeepgramLiveProcessor(ws, onPartial, onFinal, onError);
  }

  private constructor(
    ws: WebSocket,
    private readonly onPartial: (segment: SegmentInput) => void,
    private readonly onFinal: (segment: SegmentInput) => Promise<void>,
    private readonly onError: (err: Error) => void,
  ) {
    this.ws = ws;
    this.ws.on("message", (data) => void this.handleMessage(data));
    this.ws.on("error", (err) => {
      if (!this.closed) this.onError(err);
    });
    this.ws.on("close", () => {
      if (!this.closed) this.onError(new Error("Deepgram realtime connection closed"));
    });
  }

  sendAudio(chunk: Buffer): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(chunk);
  }

  async finish(): Promise<void> {
    this.closed = true;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "Finalize" }));
      await delay(3000);
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
        this.ws.close(1000);
      }
    }
  }

  abort(): void {
    this.closed = true;
    this.ws.close();
  }

  private async handleMessage(data: RawData): Promise<void> {
    const json = parseJson(data) as
      | {
          type?: string;
          start?: number;
          duration?: number;
          is_final?: boolean;
          speech_final?: boolean;
          channel?: {
            alternatives?: Array<{
              transcript?: string;
              words?: Array<{
                start?: number;
                end?: number;
                speaker?: number;
              }>;
            }>;
          };
        }
      | null;
    if (!json || json.type !== "Results") return;

    const alternative = json.channel?.alternatives?.[0];
    const text = alternative?.transcript?.trim();
    if (!alternative || !text) return;

    const words = alternative.words ?? [];
    const firstSpeaker = words.find((word) => word.speaker != null)?.speaker;
    const startMs = Math.round((json.start ?? words[0]?.start ?? 0) * 1000);
    const wordEnd = words.at(-1)?.end;
    const endMs = Math.round(
      (wordEnd ?? (json.start ?? 0) + (json.duration ?? 0)) * 1000,
    );
    const segment: SegmentInput = {
      startMs,
      endMs: Math.max(startMs, endMs),
      speaker: firstSpeaker != null ? `Speaker ${firstSpeaker}` : null,
      text,
    };

    if (json.is_final || json.speech_final) {
      const key = `${segment.startMs}:${segment.endMs}:${segment.text}`;
      if (this.finalKeys.has(key)) return;
      this.finalKeys.add(key);
      await this.onFinal(segment);
    } else {
      this.onPartial(segment);
    }
  }
}

class OpenAiCompatibleMicroBatchProcessor implements LiveProcessor {
  private buffer = Buffer.alloc(0);
  private offsetMs = 0;
  private chain = Promise.resolve();
  private aborted = false;

  constructor(
    private readonly opts: ResolvedProvider,
    private readonly onFinal: (segment: SegmentInput) => Promise<void>,
  ) {
    if (!opts.baseUrl) {
      throw new Error("OpenAI-compatible base URL is not configured");
    }
  }

  sendAudio(chunk: Buffer): void {
    if (this.aborted) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= COMPATIBLE_WINDOW_BYTES) {
      const window = this.buffer.subarray(0, COMPATIBLE_WINDOW_BYTES);
      this.buffer = this.buffer.subarray(COMPATIBLE_WINDOW_BYTES);
      this.enqueueWindow(Buffer.from(window), this.offsetMs);
      this.offsetMs += COMPATIBLE_WINDOW_MS;
    }
  }

  async finish(): Promise<void> {
    if (this.buffer.length > PCM_BYTES_PER_SECOND / 2) {
      const window = this.buffer;
      this.buffer = Buffer.alloc(0);
      const startMs = this.offsetMs;
      this.offsetMs += pcmDurationMs(window.length);
      this.enqueueWindow(window, startMs);
    }
    await this.chain;
  }

  abort(): void {
    this.aborted = true;
    this.buffer = Buffer.alloc(0);
  }

  private enqueueWindow(pcm: Buffer, offsetMs: number): void {
    this.chain = this.chain.then(() => this.transcribeWindow(pcm, offsetMs));
  }

  private async transcribeWindow(pcm: Buffer, offsetMs: number): Promise<void> {
    if (this.aborted || !this.opts.baseUrl) return;

    const wav = makeWav(pcm);
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
      "audio.wav",
    );
    form.append("model", this.opts.model || "whisper-1");
    form.append("language", this.opts.language);
    form.append("response_format", "verbose_json");

    const url = `${this.opts.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.opts.apiKey
        ? { Authorization: `Bearer ${this.opts.apiKey}` }
        : undefined,
      body: form,
    });
    if (!res.ok) throw new Error(`${url} ${res.status}: ${await res.text()}`);

    const durationMs = pcmDurationMs(pcm.length);
    const json = (await res.json()) as {
      text?: string;
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    if (json.segments?.length) {
      for (const segment of json.segments) {
        await this.onFinal({
          startMs: offsetMs + Math.round(segment.start * 1000),
          endMs: offsetMs + Math.round(segment.end * 1000),
          speaker: null,
          text: segment.text.trim(),
        });
      }
      return;
    }

    if (json.text?.trim()) {
      await this.onFinal({
        startMs: offsetMs,
        endMs:
          offsetMs + Math.round((json.duration ?? durationMs / 1000) * 1000),
        speaker: null,
        text: json.text.trim(),
      });
    }
  }
}

class LiveAudioSession {
  private processor: LiveProcessor | null = null;
  private accumulator: TranscriptSegmentAccumulator | null = null;
  private queue: Buffer[] = [];
  private finalizing = false;
  private finished = false;

  constructor(
    private readonly meetingId: string,
    private readonly ws: WebSocket,
    private readonly log: FastifyBaseLogger,
  ) {}

  start(): void {
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) {
        this.handleAudio(asBuffer(data));
        return;
      }
      this.handleControl(data);
    });
    this.ws.on("close", () => {
      if (!this.finished) void this.finalize(false);
    });
    this.ws.on("error", (err) => {
      this.log.warn({ err, meetingId: this.meetingId }, "live audio socket error");
      if (!this.finished) void this.fail(err instanceof Error ? err : new Error(String(err)));
    });

    void this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const provider = await resolveProvider(this.meetingId);
      if (this.finished || this.finalizing) return;
      if (!provider) {
        await updateRealtimeStatus(
          this.meetingId,
          "skipped",
          "Realtime transcription provider is not configured",
        );
        sendJson(this.ws, { type: "skipped" });
        this.ws.close(1000, "provider_not_configured");
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(schema.transcriptSegments)
          .where(eq(schema.transcriptSegments.meetingId, this.meetingId));
        await tx
          .update(schema.meetings)
          .set({
            realtimeTranscriptStatus: "streaming",
            realtimeTranscriptError: null,
            realtimeFinalizedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.meetings.id, this.meetingId));
      });
      if (this.finished || this.finalizing) return;
      broadcast(this.meetingId, { type: "snapshot", segments: [] });
      broadcast(this.meetingId, { type: "status", status: "streaming" });

      this.accumulator = new TranscriptSegmentAccumulator(
        this.meetingId,
        (segment) =>
          insertFinalSegment(this.meetingId, segment).then(() => undefined),
      );
      const onFinal = (segment: SegmentInput) =>
        this.accumulator?.add(segment) ?? Promise.resolve();
      if (provider.provider === "deepgram") {
        this.processor = await DeepgramLiveProcessor.create(
          provider,
          (segment) =>
            broadcast(this.meetingId, {
              type: "partial",
              segment: { meetingId: this.meetingId, ...segment },
            }),
          onFinal,
          (err) => void this.fail(err),
        );
      } else {
        this.processor = new OpenAiCompatibleMicroBatchProcessor(provider, onFinal);
      }
      if (this.finished || this.finalizing) {
        this.processor.abort();
        return;
      }

      for (const chunk of this.queue) this.processor.sendAudio(chunk);
      this.queue = [];
      sendJson(this.ws, { type: "ready" });
    } catch (err) {
      await this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleAudio(chunk: Buffer): void {
    if (this.finalizing || this.finished) return;
    if (this.processor) {
      this.processor.sendAudio(chunk);
      return;
    }
    this.queue.push(chunk);
    const queuedBytes = this.queue.reduce((sum, item) => sum + item.length, 0);
    if (queuedBytes > PCM_BYTES_PER_SECOND * 30) this.queue.shift();
  }

  private handleControl(data: RawData): void {
    const json = parseJson(data) as { type?: string } | null;
    if (json?.type === "finalize") void this.finalize(true);
  }

  private async finalize(ack: boolean): Promise<void> {
    if (this.finalizing || this.finished) return;
    this.finalizing = true;
    try {
      await updateRealtimeStatus(this.meetingId, "finalizing");
      if (this.processor) await this.processor.finish();
      await this.accumulator?.flush();
      this.finished = true;
      await updateRealtimeStatus(this.meetingId, "completed");
      if (ack) sendJson(this.ws, { type: "completed" });
      this.ws.close(1000, "completed");
    } catch (err) {
      await this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async fail(err: Error): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.processor?.abort();
    this.accumulator?.clear();
    await updateRealtimeStatus(this.meetingId, "failed", err.message);
    broadcast(this.meetingId, { type: "error", message: err.message });
    sendJson(this.ws, { type: "failed", error: err.message });
    this.ws.close(1011, "realtime_failed");
  }
}

export function handleLiveAudioSocket(
  meetingId: string,
  ws: WebSocket,
  log: FastifyBaseLogger,
): void {
  new LiveAudioSession(meetingId, ws, log).start();
}

export async function waitForRealtimeFinalization(
  meetingId: string,
  timeoutMs = 10_000,
): Promise<MeetingRow | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, meetingId))
      .limit(1);
    if (!meeting) return null;
    if (meeting.realtimeTranscriptStatus !== "finalizing") return meeting;
    await delay(500);
  }
  const [meeting] = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.id, meetingId))
    .limit(1);
  return meeting ?? null;
}
