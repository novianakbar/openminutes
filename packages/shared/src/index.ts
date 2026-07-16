export * from "./schema";

export type TranscriptionProviderName = "deepgram" | "openai_compatible";

// Bentuk JSON settings transcription yang dipertukarkan API <-> web/worker.
export interface TranscriptionSettings {
  provider: TranscriptionProviderName;
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  language: string;
}

export type Platform = "google_meet" | "teams" | "zoom";
export type TranscriptionMode = "post_meeting" | "realtime";
export const TRANSCRIPTION_LANGUAGES = [
  { code: "id", label: "Indonesian" },
  { code: "en", label: "English" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "hi", label: "Hindi" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "ms", label: "Malay" },
  { code: "ar", label: "Arabic" },
  { code: "tr", label: "Turkish" },
] as const;
export type TranscriptionLanguage =
  (typeof TRANSCRIPTION_LANGUAGES)[number]["code"];
export const TRANSCRIPTION_LANGUAGE_CODES = TRANSCRIPTION_LANGUAGES.map(
  (language) => language.code,
) as [TranscriptionLanguage, ...TranscriptionLanguage[]];
export type RealtimeTranscriptStatus =
  | "streaming"
  | "finalizing"
  | "completed"
  | "failed"
  | "skipped";

export interface TranscriptSegmentBase {
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
}

export interface TranscriptGroupingOptions {
  maxDurationMs?: number;
  maxChars?: number;
  maxGapMs?: number;
  minSentenceDurationMs?: number;
  respectSpeakerChange?: boolean;
}

const defaultTranscriptGroupingOptions = {
  maxDurationMs: 45_000,
  maxChars: 700,
  maxGapMs: 2_500,
  minSentenceDurationMs: 12_000,
  respectSpeakerChange: true,
};

function endsWithSentence(text: string): boolean {
  return /[.!?…。！？]["')\]]?$/.test(text.trim());
}

function joinTranscriptText(first: string, second: string): string {
  const left = first.trim();
  const right = second.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

export function groupTranscriptSegments(
  segments: TranscriptSegmentBase[],
  options: TranscriptGroupingOptions = {},
): TranscriptSegmentBase[] {
  const opts = { ...defaultTranscriptGroupingOptions, ...options };
  const sorted = segments
    .map((segment) => ({ ...segment, text: segment.text.trim() }))
    .filter((segment) => segment.text)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const grouped: TranscriptSegmentBase[] = [];
  let current: TranscriptSegmentBase | null = null;

  const flush = () => {
    if (!current) return;
    grouped.push(current);
    current = null;
  };

  for (const segment of sorted) {
    if (!current) {
      current = { ...segment };
      continue;
    }

    const joinedText = joinTranscriptText(current.text, segment.text);
    const gapMs = segment.startMs - current.endMs;
    const durationMs = Math.max(current.endMs, segment.endMs) - current.startMs;
    const speakerChanged =
      opts.respectSpeakerChange && current.speaker !== segment.speaker;
    const naturalSentenceBreak =
      endsWithSentence(current.text) &&
      current.endMs - current.startMs >= opts.minSentenceDurationMs;

    if (
      speakerChanged ||
      gapMs > opts.maxGapMs ||
      durationMs > opts.maxDurationMs ||
      joinedText.length > opts.maxChars ||
      naturalSentenceBreak
    ) {
      flush();
      current = { ...segment };
      continue;
    }

    current = {
      startMs: current.startMs,
      endMs: Math.max(current.endMs, segment.endMs),
      speaker: current.speaker,
      text: joinedText,
    };
  }

  flush();
  return grouped;
}

export type BotStatus =
  | "pending"
  | "joining"
  | "waiting_admission"
  | "recording"
  | "uploading"
  | "processing_transcript"
  | "completed"
  | "transcription_skipped"
  | "failed";

export function detectPlatform(meetingUrl: string): Platform | null {
  let url: URL;
  try {
    url = new URL(meetingUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "meet.google.com") return "google_meet";
  if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com")) {
    return "teams";
  }
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return "zoom";
  return null;
}

const meetingTitleAdjectives = [
  "Focused",
  "Aligned",
  "Clear",
  "Strategic",
  "Productive",
  "Structured",
  "Insightful",
  "Coordinated",
];

const meetingTitleNouns = [
  "Briefing",
  "Session",
  "Sync",
  "Review",
  "Discussion",
  "Planning",
  "Standup",
  "Workshop",
];

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return segment.trim();
  }
}

function getSearchParamCaseInsensitive(
  params: URLSearchParams,
  name: string,
): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of params.entries()) {
    if (key.toLowerCase() === target && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function generateMeetingTitle(platform?: Platform): string {
  const adjective =
    meetingTitleAdjectives[
      Math.floor(Math.random() * meetingTitleAdjectives.length)
    ];
  const noun =
    meetingTitleNouns[Math.floor(Math.random() * meetingTitleNouns.length)];
  const suffix = String(Math.floor(100 + Math.random() * 900));
  const platformPrefix =
    platform === "google_meet"
      ? "Meet"
      : platform === "teams"
        ? "Teams"
        : platform === "zoom"
          ? "Zoom"
          : "";
  return [adjective, platformPrefix, noun, suffix].filter(Boolean).join(" ");
}

export function extractMeetingExternalId(
  meetingUrl: string,
  platform: Platform,
): string | null {
  let url: URL;
  try {
    url = new URL(meetingUrl);
  } catch {
    return null;
  }

  const segments = url.pathname
    .split("/")
    .map(decodeSegment)
    .filter(Boolean);

  if (platform === "google_meet") {
    const code = segments[0];
    if (code && /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i.test(code)) {
      return code.toLowerCase();
    }
    return null;
  }

  if (platform === "zoom") {
    // Nomor meeting = 9–11 digit di salah satu segmen path: mencakup /j/{id},
    // /s/{id}, /wc/{id}/join, dan /wc/join/{id}.
    const numeric = segments.find((segment) => /^\d{9,11}$/.test(segment));
    if (numeric) return numeric;
    // Personal Meeting Room via vanity link: zoom.us/my/{nama}.
    const myIndex = segments.findIndex(
      (segment) => segment.toLowerCase() === "my",
    );
    if (myIndex >= 0 && segments[myIndex + 1]) {
      return segments[myIndex + 1].toLowerCase();
    }
    return null;
  }

  const meetingId = getSearchParamCaseInsensitive(url.searchParams, "meetingId");
  if (meetingId) return meetingId;

  const threadId =
    getSearchParamCaseInsensitive(url.searchParams, "threadId") ??
    getSearchParamCaseInsensitive(url.searchParams, "conversationId");
  if (threadId) return threadId;

  const meetupJoinIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "meetup-join",
  );
  if (meetupJoinIndex >= 0) {
    const joinId = segments[meetupJoinIndex + 1];
    if (joinId && joinId !== "0") return joinId;
  }

  const meetIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "meet",
  );
  if (meetIndex >= 0) {
    const joinId = segments[meetIndex + 1];
    if (joinId) return joinId;
  }

  const opaqueJoinId = segments.find((segment) => {
    const normalized = segment.toLowerCase();
    return normalized.startsWith("19:") || normalized.includes("meeting_");
  });
  return opaqueJoinId ?? null;
}
