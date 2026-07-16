import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";

export const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export const transcriptionQueue = new Queue("transcription", {
  connection: redisConnection,
});

// Status BullMQ yang berarti job masih akan/sedang diproses. Job "active"
// milik worker yang mati akan dideteksi stalled dan dijalankan ulang saat
// worker berikutnya hidup, jadi tetap dihitung berjalan.
const RUNNING_STATES = new Set([
  "active",
  "waiting",
  "delayed",
  "prioritized",
  "waiting-children",
]);

export type EnqueueResult = "queued" | "already_running";

// jobId deterministik per meeting supaya enqueue idempoten: klik retry dobel
// atau retry saat job otomatis masih di antrean tidak membuat job ganda.
export async function enqueueTranscription(
  meetingId: string,
  objectKey: string,
): Promise<EnqueueResult> {
  const jobId = `transcribe-${meetingId}`;

  const existing = await transcriptionQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (RUNNING_STATES.has(state)) return "already_running";
    // Job lama sudah completed/failed — harus dihapus dulu, BullMQ diam-diam
    // mengabaikan add() dengan jobId yang masih ada.
    await existing.remove();
  }

  await transcriptionQueue.add(
    "transcribe",
    { meetingId, objectKey },
    { jobId, attempts: 3, backoff: { type: "exponential", delay: 10_000 } },
  );
  return "queued";
}
