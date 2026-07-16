import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TRANSCRIPTION_LANGUAGES } from "@openminutes/shared";
import {
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  ExternalLink,
  FileText,
  Images,
  Loader2,
  MonitorPlay,
  RefreshCw,
  ScrollText,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { isBotActive, isInProgress, StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { formatDateTime, formatDuration, formatTimestamp } from "../lib/format";
import { PLATFORM_LABEL } from "../lib/platform";
import { PlatformIcon } from "../components/icons/PlatformIcons";
import { Alert } from "../components/ui/Alert";
import { Button, buttonClass } from "../components/ui/Button";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { AudioPlayer } from "../components/ui/AudioPlayer";
import type {
  LivePartialTranscriptSegment,
  LiveTranscriptEvent,
  MeetingStatusEvent,
  MeetingScreenshot,
  RealtimeTranscriptStatus,
  TranscriptSegment,
} from "../lib/types";

// processing_transcript tanpa update selama ini dianggap macet (worker mati /
// job hilang dari Redis) — polling dihentikan dan tombol retry dimunculkan.
const TRANSCRIPT_STUCK_MS = 10 * 60 * 1000;

const eventLabels: Record<string, string> = {
  pending: "Session created",
  joining: "Join started",
  waiting_admission: "Awaiting host approval",
  recording: "Recording started",
  uploading: "Audio upload started",
  recording_ready: "Recording available",
  processing_transcript: "Transcription started",
  completed: "Completed",
  transcription_skipped: "Transcription skipped",
  failed: "Failed",
  stop_requested: "Stop requested",
};

function languageLabel(code: string): string {
  return (
    TRANSCRIPTION_LANGUAGES.find((language) => language.code === code)?.label ??
    code
  );
}

function isTranscriptStuck(status: string, updatedAt: string): boolean {
  return (
    status === "processing_transcript" &&
    Date.now() - new Date(updatedAt).getTime() > TRANSCRIPT_STUCK_MS
  );
}

function mergeTranscriptSegments(
  first: TranscriptSegment[],
  second: TranscriptSegment[],
): TranscriptSegment[] {
  const byId = new Map<number, TranscriptSegment>();
  for (const segment of first) byId.set(segment.id, segment);
  for (const segment of second) byId.set(segment.id, segment);
  return [...byId.values()].sort((a, b) => a.startMs - b.startMs || a.id - b.id);
}

function ScreenshotGallery({
  meetingId,
  screenshots,
  active,
}: {
  meetingId: string;
  screenshots: MeetingScreenshot[];
  active: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Images className="h-5 w-5 text-muted-foreground" aria-hidden />
          Screenshots
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Captured automatically when the visible meeting content changes.
        </p>
      </CardHeader>

      {screenshots.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No screenshots yet"
          description={
            active
              ? "Screenshots will appear when the shared screen or visible content changes."
              : "No screenshots were captured."
          }
          className="m-4 border-0 bg-background px-4 py-10"
        />
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {screenshots.map((screenshot) => {
            const src = api.meetingScreenshotUrl(meetingId, screenshot.id);
            return (
              <a
                key={screenshot.id}
                href={src}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-accent"
              >
                <div className="aspect-video overflow-hidden bg-black">
                  <img
                    src={src}
                    alt={`Screenshot at ${formatTimestamp(screenshot.capturedAtMs)}`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="font-semibold tabular-nums">
                    {formatTimestamp(screenshot.capturedAtMs)}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {screenshot.width}x{screenshot.height}
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function BotProgressTimeline({ events }: { events: MeetingStatusEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Session events</CardTitle>
      </CardHeader>

      {events.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          No event history is available for this meeting.
        </p>
      ) : (
        <ol className="space-y-0 p-4" aria-label="Meeting event timeline">
          {events.map((event, index) => {
          const failed = event.status === "failed";
          const latest = index === events.length - 1;
          return (
            <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
              {index < events.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-border"
                />
              )}
              <div className="relative z-10">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                    failed
                      ? "border-destructive bg-destructive/10 text-destructive"
                      : latest
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-accent bg-accent text-accent-foreground"
                  }`}
                >
                  {failed ? (
                    <XCircle className="h-3.5 w-3.5" aria-hidden />
                  ) : latest ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </span>
              </div>
              <div className="min-w-0 pt-0.5">
                <span className="block text-sm font-semibold text-foreground">
                  {eventLabels[event.status] ?? event.status}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                </span>
                {event.message && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {event.message}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      )}
    </Card>
  );
}

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"summary" | "transcript">("summary");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [livePartial, setLivePartial] =
    useState<LivePartialTranscriptSegment | null>(null);
  const [liveTranscriptStatus, setLiveTranscriptStatus] =
    useState<RealtimeTranscriptStatus | null>(null);
  const [liveTranscriptError, setLiveTranscriptError] = useState<string | null>(null);

  const stopMutation = useMutation({
    mutationFn: () => api.stopBot(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteMeeting(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.removeQueries({ queryKey: ["meetings", id] });
      navigate("/meetings", { replace: true });
    },
  });

  const { data: meeting, isPending, isError, error } = useQuery({
    queryKey: ["meetings", id],
    queryFn: () => api.getMeeting(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      // Stop sudah diminta tapi bot belum benar-benar berhenti → poll rapat
      // supaya transisi ke "Mengunggah"/"Selesai" cepat terlihat.
      if (stopMutation.isSuccess && isBotActive(data.status)) return 1500;
      // Transkripsi macet — percuma polling terus, tunggu aksi user.
      if (isTranscriptStuck(data.status, data.updatedAt)) return false;
      return isInProgress(data.status) ? 5000 : false;
    },
  });

  const retranscribeMutation = useMutation({
    mutationFn: () => api.retranscribe(id!),
    onSuccess: () => {
      // Status berubah ke processing_transcript → refetchInterval ikut
      // mengevaluasi ulang dan polling jalan lagi.
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  // DELETE /bots merespons instan, tapi bot butuh beberapa detik untuk
  // berhenti + upload. Tombol harus tetap terkunci sepanjang jeda itu —
  // kalau tidak, user mengira tak terjadi apa-apa dan mengklik berulang.
  const isStopping =
    stopMutation.isPending ||
    (stopMutation.isSuccess && isBotActive(meeting?.status ?? ""));

  const hasAudio = Boolean(meeting?.audioObjectKey);
  const {
    data: audioUrl,
    isPending: audioPending,
    isError: audioError,
  } = useQuery({
    queryKey: ["meetings", id, "audio"],
    queryFn: async () => URL.createObjectURL(await api.fetchAudioBlob(id!)),
    enabled: Boolean(id) && hasAudio,
    staleTime: Infinity,
    gcTime: 0,
  });

  // Lepas object URL saat halaman ditinggalkan agar blob tidak menumpuk di memori
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (!meeting) return;
    setLiveSegments((current) => mergeTranscriptSegments(meeting.transcript, current));
  }, [meeting]);

  useEffect(() => {
    if (!meeting || meeting.mode !== "realtime" || !isBotActive(meeting.status)) {
      return;
    }

    setLiveTranscriptStatus(meeting.realtimeTranscriptStatus);
    setLiveTranscriptError(meeting.realtimeTranscriptError);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/api/meetings/${meeting.id}/transcript/live`,
    );

    ws.onmessage = (event) => {
      let message: LiveTranscriptEvent;
      try {
        message = JSON.parse(event.data) as LiveTranscriptEvent;
      } catch {
        return;
      }
      if (message.type === "snapshot") {
        setLiveSegments(message.segments);
        setLivePartial(null);
      } else if (message.type === "partial") {
        setLivePartial(message.segment);
      } else if (message.type === "final") {
        setLiveSegments((current) =>
          mergeTranscriptSegments(current, [message.segment]),
        );
        setLivePartial(null);
      } else if (message.type === "status") {
        setLiveTranscriptStatus(message.status);
        if (message.status === "completed") {
          queryClient.invalidateQueries({ queryKey: ["meetings", id] });
          queryClient.invalidateQueries({ queryKey: ["meetings"] });
        }
      } else if (message.type === "error") {
        setLiveTranscriptError(message.message);
      }
    };
    ws.onerror = () => {
      setLiveTranscriptError("Live transcript connection was interrupted.");
    };

    return () => ws.close(1000, "leaving_page");
  }, [id, meeting?.id, meeting?.mode, meeting?.status, queryClient]);

  if (isPending) {
    return (
      <Card className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Loading meeting...
      </Card>
    );
  }

  if (isError || !meeting) {
    return (
      <Alert tone="danger" role="alert" title="Unable to load meeting">
        <p>
          {error instanceof ApiError && error.status === 404
            ? "Meeting not found."
            : "The meeting details could not be loaded."}
        </p>
        <Link to="/meetings" className="mt-1 inline-block underline">
          Back to meetings
        </Link>
      </Alert>
    );
  }

  const transcriptStuck = isTranscriptStuck(meeting.status, meeting.updatedAt);
  const displayTranscript =
    meeting.mode === "realtime"
      ? mergeTranscriptSegments(meeting.transcript, liveSegments)
      : meeting.transcript;
  const realtimeStatus =
    liveTranscriptStatus ?? meeting.realtimeTranscriptStatus ?? null;
  const realtimeError =
    liveTranscriptError ?? meeting.realtimeTranscriptError ?? null;
  const canRetranscribe =
    hasAudio &&
    (["completed", "failed", "transcription_skipped"].includes(meeting.status) ||
      transcriptStuck);
  const hasStoredTranscript = displayTranscript.length > 0;
  const hasVisibleTranscript = hasStoredTranscript || Boolean(livePartial);

  const handleRetranscribe = () => {
    if (
      hasStoredTranscript &&
      !window.confirm("The current transcript will be replaced. Continue?")
    ) {
      return;
    }
    retranscribeMutation.mutate();
  };

  const retranscribeButton = canRetranscribe && (
    <Button
      type="button"
      variant="secondary"
      onClick={handleRetranscribe}
      disabled={retranscribeMutation.isPending}
      aria-busy={retranscribeMutation.isPending}
    >
      {retranscribeMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="h-4 w-4" aria-hidden />
      )}
      {hasStoredTranscript ? "Retranscribe" : "Create transcript"}
    </Button>
  );

  return (
    <div>
      <Link
        to="/meetings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All meetings
      </Link>

      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-bold tracking-tight">
                {meeting.title}
              </h1>
              <StatusBadge status={meeting.status} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <PlatformIcon
                  platform={meeting.platform}
                  className="h-4 w-4 shrink-0"
                />
                {PLATFORM_LABEL[meeting.platform] ?? meeting.platform}
              </span>
              <span className="max-w-full truncate tabular-nums">
                Meeting ID: {meeting.externalMeetingId}
              </span>
              <span className="max-w-full truncate">
                Bot: {meeting.botName}
              </span>
              <a
                href={meeting.meetingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-accent underline-offset-4 transition-colors hover:underline"
              >
                Meeting link
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isBotActive(meeting.status) && (
              <Button
                type="button"
                variant="danger"
                onClick={() => stopMutation.mutate()}
                disabled={isStopping}
                aria-busy={isStopping}
              >
                {isStopping ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Square className="h-4 w-4" aria-hidden />
                )}
                {isStopping ? "Stopping..." : "Stop session"}
              </Button>
            )}
            <Button
              type="button"
              variant="danger"
              onClick={() => setDeleteOpen(true)}
              disabled={isInProgress(meeting.status) || deleteMutation.isPending}
              title={
                isInProgress(meeting.status)
                  ? "Stop the session before deleting"
                  : undefined
              }
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete
            </Button>
          </div>
        </div>
        <div className="grid gap-3 border-t border-border bg-background px-5 py-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Mode
            </p>
            <p className="mt-2 text-sm font-bold">
              {meeting.mode === "realtime" ? "Real-time" : "After meeting"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Language
            </p>
            <p className="mt-2 text-sm font-bold">{languageLabel(meeting.language)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Created
            </p>
            <p className="mt-2 text-sm font-bold">{formatDateTime(meeting.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Last updated
            </p>
            <p className="mt-2 text-sm font-bold">{formatDateTime(meeting.updatedAt)}</p>
          </div>
        </div>
      </Card>

      <div className="mb-6 space-y-3">
        {meeting.error && (
          <Alert tone="danger" role="alert" title="Session error">
            {meeting.error}
          </Alert>
        )}

        {isStopping && !stopMutation.isPending && (
          <Alert tone="info" title="Stopping session">
            Waiting for OpenMinutes to leave the meeting and upload the recording.
            Status updates automatically.
          </Alert>
        )}

        {transcriptStuck && (
          <Alert tone="warning" title="Transcription needs attention">
            No progress has been detected for more than 10 minutes. Restart
            transcription to create a new job.
          </Alert>
        )}

        {retranscribeMutation.isError && (
          <Alert tone="danger" role="alert">
            {retranscribeMutation.error instanceof ApiError
              ? retranscribeMutation.error.message
              : "Unable to start transcription."}
          </Alert>
        )}

        {meeting.mode === "realtime" &&
          realtimeStatus === "streaming" &&
          isBotActive(meeting.status) && (
            <Alert tone="info" title="Live transcript is running">
              Final segments are saved as the meeting continues.
            </Alert>
          )}

        {meeting.mode === "realtime" &&
          realtimeError &&
          realtimeStatus === "failed" && (
            <Alert tone="warning" title="Live transcript fell back">
              {realtimeError}
            </Alert>
          )}

        {stopMutation.isError && (
          <Alert tone="danger" role="alert">
            {stopMutation.error instanceof ApiError
              ? stopMutation.error.message
              : "Unable to stop the session."}
          </Alert>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {isBotActive(meeting.status) && !isStopping && (
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MonitorPlay className="h-5 w-5 text-muted-foreground" aria-hidden />
                    Live View
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Monitor the meeting session when host approval or manual action is required.
                  </p>
                </div>
                <Link
                  to={`/meetings/${meeting.id}/live`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClass({ variant: "secondary" })}
                >
                  <MonitorPlay className="h-4 w-4" aria-hidden />
                  Open Live View
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                </Link>
              </CardHeader>
            </Card>
          )}

          <ScreenshotGallery
            meetingId={meeting.id}
            screenshots={meeting.screenshots}
            active={isBotActive(meeting.status)}
          />

          <Card className="overflow-hidden">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Meeting notes</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review the summary and transcript in one focused workspace.
                </p>
              </div>
              <div className="flex rounded-lg border border-border bg-background p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("summary")}
                  className={`h-9 cursor-pointer rounded-md px-3 text-sm font-bold transition-colors duration-200 ${
                    activeTab === "summary"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  }`}
                >
                  Summary
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("transcript")}
                  className={`h-9 cursor-pointer rounded-md px-3 text-sm font-bold transition-colors duration-200 ${
                    activeTab === "transcript"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  }`}
                >
                  Transcript
                </button>
              </div>
            </CardHeader>

            {activeTab === "summary" ? (
              <div className="min-h-[440px] p-5">
                <EmptyState
                  icon={FileText}
                  title="Summary is not available yet"
                  description="This workspace is reserved for executive summaries, action items, decisions, and follow-ups."
                  className="min-h-[400px] border-0 bg-background"
                />
              </div>
            ) : (
              <div className="p-4">
                {!hasVisibleTranscript ? (
                  <EmptyState
                    icon={ScrollText}
                    title="Transcript is not available yet"
                    description={
                      meeting.status === "transcription_skipped"
                        ? "Transcription was skipped because no provider is configured. Configure a provider to generate a transcript from the existing recording."
                        : meeting.status === "failed" && hasAudio
                          ? "Transcription failed, but the recording is still available. You can retry anytime."
                          : transcriptStuck
                            ? "Transcription has not progressed. Restart transcription to try again."
                            : isInProgress(meeting.status)
                              ? "The meeting is still active or processing. This page updates automatically."
                              : "No transcript is available for this meeting."
                    }
                    action={retranscribeButton || undefined}
                    className="min-h-[400px] border-0 bg-background"
                  />
                ) : (
                  <>
                    <div className="mb-3 flex justify-end">{retranscribeButton}</div>
                    <ol className="divide-y divide-border">
                      {displayTranscript.map((segment) => (
                        <li key={segment.id} className="grid gap-3 py-4 sm:grid-cols-[76px_1fr]">
                          <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                            {formatTimestamp(segment.startMs)}
                          </span>
                          <div className="min-w-0">
                            {segment.speaker && (
                              <span className="mb-1.5 inline-flex rounded-full bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent">
                                {segment.speaker}
                              </span>
                            )}
                            <p className="text-sm leading-7">{segment.text}</p>
                          </div>
                        </li>
                      ))}
                      {livePartial && (
                        <li className="grid gap-3 py-4 sm:grid-cols-[76px_1fr]">
                          <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                            {formatTimestamp(livePartial.startMs)}
                          </span>
                          <div className="min-w-0">
                            <span className="mb-1.5 inline-flex rounded-full bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent">
                              Live
                            </span>
                            <p className="text-sm leading-7 text-muted-foreground">
                              {livePartial.text}
                            </p>
                          </div>
                        </li>
                      )}
                    </ol>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AudioLines className="h-5 w-5 text-muted-foreground" aria-hidden />
                Recording
              </CardTitle>
            </CardHeader>
            <div className="p-4">
              {!hasAudio ? (
                <EmptyState
                  icon={AudioLines}
                  title="Recording is not available yet"
                  description={
                    isInProgress(meeting.status)
                      ? "The recording appears after the meeting ends or the session is stopped."
                      : "No audio recording is available for this meeting."
                  }
                  className="border-0 bg-background px-4 py-10"
                />
              ) : audioPending ? (
                <div className="flex items-center gap-2 rounded-lg bg-background px-4 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading recording...
                </div>
              ) : audioError || !audioUrl ? (
                <Alert tone="danger" role="alert">
                  Unable to load the recording.
                </Alert>
              ) : (
                <AudioPlayer
                  src={audioUrl}
                  downloadName={`meeting-${meeting.id}.ogg`}
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">File details</CardTitle>
            </CardHeader>
            <div className="space-y-3 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-semibold">
                  {meeting.durationSec != null ? formatDuration(meeting.durationSec) : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Transcript segments</span>
                <span className="font-semibold">{displayTranscript.length}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Screenshots</span>
                <span className="font-semibold">{meeting.screenshots.length}</span>
              </div>
            </div>
          </Card>

          <BotProgressTimeline events={meeting.events} />
        </aside>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this meeting?"
        description={
          <div className="space-y-3">
            <p>
              This action is permanent and cannot be undone. Deleting this meeting will
              also remove:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-foreground">
              <li>Audio recording</li>
              <li>Transcript</li>
              <li>Summary</li>
              <li>Session status history</li>
            </ul>
          </div>
        }
        confirmLabel={deleteMutation.isPending ? "Deleting..." : "Delete permanently"}
        confirmPhrase="DELETE"
        loading={deleteMutation.isPending}
        errorMessage={
          deleteMutation.isError
            ? deleteMutation.error instanceof ApiError
              ? deleteMutation.error.message
              : "Unable to delete the meeting."
            : null
        }
        onConfirm={() => deleteMutation.mutate()}
        onClose={() => {
          setDeleteOpen(false);
          deleteMutation.reset();
        }}
      />
    </div>
  );
}
