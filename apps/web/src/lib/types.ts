import type {
  BotStatus,
  Platform,
  RealtimeTranscriptStatus,
  TranscriptionLanguage,
  TranscriptionMode,
} from "@openminutes/shared";

export type {
  BotStatus,
  Platform,
  RealtimeTranscriptStatus,
  TranscriptionLanguage,
  TranscriptionMode,
};

// Bentuk JSON dari API (timestamp jadi string ISO, bukan Date)
export interface Meeting {
  id: string;
  userId: string;
  title: string;
  platform: Platform;
  externalMeetingId: string;
  meetingUrl: string;
  mode: TranscriptionMode;
  language: string;
  botName: string;
  status: BotStatus;
  containerId: string | null;
  audioObjectKey: string | null;
  durationSec: number | null;
  realtimeTranscriptStatus: RealtimeTranscriptStatus | null;
  realtimeTranscriptError: string | null;
  realtimeFinalizedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  transcriptCount?: number;
}

export interface MeetingStatusEvent {
  id: number;
  meetingId: string;
  status: string;
  message: string | null;
  createdAt: string;
}

export interface TranscriptSegment {
  id: number;
  meetingId: string;
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
}

export interface MeetingScreenshot {
  id: number;
  meetingId: string;
  objectKey: string;
  capturedAtMs: number;
  width: number;
  height: number;
  hash: string;
  createdAt: string;
}

export type LivePartialTranscriptSegment = Omit<TranscriptSegment, "id">;

export type LiveTranscriptEvent =
  | { type: "snapshot"; segments: TranscriptSegment[] }
  | { type: "partial"; segment: LivePartialTranscriptSegment }
  | { type: "final"; segment: TranscriptSegment }
  | {
      type: "status";
      status: RealtimeTranscriptStatus;
      message?: string | null;
    }
  | { type: "error"; message: string };

export interface MeetingDetail extends Meeting {
  transcript: TranscriptSegment[];
  events: MeetingStatusEvent[];
  screenshots: MeetingScreenshot[];
}

export interface MeetingListResponse {
  items: Meeting[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: {
    total: number;
    active: number;
    waiting: number;
    transcribing: number;
  };
}
