import { Worker, Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import { type Platform, type TranscriptionMode } from "@openminutes/shared";
import { db, schema } from "../db";
import { spawnBot } from "./botManager";
import { redisConnection } from "./queue";

const SCHEDULE_QUEUE_NAME = "scheduled-bots";
const RECONCILE_INTERVAL_MS = 60_000;

export const scheduledBotQueue = new Queue(SCHEDULE_QUEUE_NAME, {
  connection: redisConnection,
});

function scheduledBotJobId(meetingId: string): string {
  return `scheduled-bot-${meetingId}`;
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

export async function enqueueScheduledBot(
  meetingId: string,
  scheduledStartAt: Date,
): Promise<void> {
  const jobId = scheduledBotJobId(meetingId);
  const existing = await scheduledBotQueue.getJob(jobId);
  if (existing) await existing.remove();

  await scheduledBotQueue.add(
    "join",
    { meetingId },
    {
      jobId,
      delay: Math.max(0, scheduledStartAt.getTime() - Date.now()),
      removeOnComplete: true,
    },
  );
}

export async function removeScheduledBotJob(meetingId: string): Promise<void> {
  const job = await scheduledBotQueue.getJob(scheduledBotJobId(meetingId));
  await job?.remove();
}

async function startScheduledMeeting(meetingId: string): Promise<void> {
  const [meeting] = await db
    .update(schema.meetings)
    .set({ status: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(schema.meetings.id, meetingId),
        eq(schema.meetings.status, "scheduled"),
      ),
    )
    .returning();

  if (!meeting) return;
  await addStatusEvent(meeting.id, "pending", "Scheduled start triggered");

  try {
    const containerId = await spawnBot({
      meetingId: meeting.id,
      meetingUrl: meeting.meetingUrl,
      platform: meeting.platform as Platform,
      mode: meeting.mode as TranscriptionMode,
      botName: meeting.botName,
      captureScreenshots: meeting.captureScreenshots,
      captureVideo: meeting.captureVideo,
    });
    await db
      .update(schema.meetings)
      .set({ containerId, status: "joining", error: null, updatedAt: new Date() })
      .where(eq(schema.meetings.id, meeting.id));
    await addStatusEvent(meeting.id, "joining", "OpenMinutes is joining the meeting");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.meetings)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(schema.meetings.id, meeting.id));
    await addStatusEvent(meeting.id, "failed", message);
  }
}

async function reconcileScheduledMeetings(): Promise<void> {
  const now = new Date();
  const scheduled = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.status, "scheduled"));

  await Promise.all(
    scheduled.map(async (meeting) => {
      if (!meeting.scheduledStartAt || meeting.scheduledStartAt <= now) {
        await startScheduledMeeting(meeting.id);
        return;
      }

      const job = await scheduledBotQueue.getJob(scheduledBotJobId(meeting.id));
      if (!job) {
        await enqueueScheduledBot(meeting.id, meeting.scheduledStartAt);
      }
    }),
  );
}

export function startScheduledBotService(): void {
  const worker = new Worker<{ meetingId: string }>(
    SCHEDULE_QUEUE_NAME,
    async (job) => {
      await startScheduledMeeting(job.data.meetingId);
    },
    { connection: redisConnection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    console.error(`Scheduled bot job ${job?.id} failed:`, err.message);
  });

  reconcileScheduledMeetings().catch((err) => {
    console.error("Scheduled bot reconciliation failed:", err);
  });
  setInterval(() => {
    reconcileScheduledMeetings().catch((err) => {
      console.error("Scheduled bot reconciliation failed:", err);
    });
  }, RECONCILE_INTERVAL_MS).unref();
}
