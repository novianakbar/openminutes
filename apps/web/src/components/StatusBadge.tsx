import type { BotStatus } from "../lib/types";

interface StatusConfig {
  label: string;
  className: string;
  pulse?: boolean;
}

const STATUS: Record<BotStatus, StatusConfig> = {
  scheduled: {
    label: "Scheduled",
    className: "bg-info/15 text-info",
  },
  pending: {
    label: "Queued",
    className: "bg-muted-foreground/10 text-muted-foreground",
  },
  joining: {
    label: "Joining",
    className: "bg-warning/15 text-warning",
    pulse: true,
  },
  waiting_admission: {
    label: "Awaiting approval",
    className: "bg-warning/15 text-warning",
    pulse: true,
  },
  recording: {
    label: "Recording",
    className: "bg-accent/15 text-accent",
    pulse: true,
  },
  uploading: {
    label: "Uploading",
    className: "bg-info/15 text-info",
    pulse: true,
  },
  processing_transcript: {
    label: "Transcribing",
    className: "bg-info/15 text-info",
    pulse: true,
  },
  completed: {
    label: "Completed",
    className: "bg-accent/15 text-accent",
  },
  transcription_skipped: {
    label: "Transcript skipped",
    className: "bg-muted-foreground/10 text-muted-foreground",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/15 text-destructive",
  },
};

// Status di luar BotStatus (data lama / nilai tak terduga) tetap dirender apa adanya
export function StatusBadge({ status }: { status: string }) {
  const config = STATUS[status as BotStatus] ?? {
    label: status,
    className: "bg-muted-foreground/10 text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ring-1 ring-current/10 ${config.className}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full bg-current ${config.pulse ? "animate-pulse" : ""}`}
      />
      {config.label}
    </span>
  );
}

export function isBotActive(status: string): boolean {
  return ["joining", "waiting_admission", "recording"].includes(status);
}

export function isInProgress(status: string): boolean {
  return isBotActive(status) || ["pending", "uploading", "processing_transcript"].includes(status);
}
