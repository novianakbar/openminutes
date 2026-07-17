import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TRANSCRIPTION_LANGUAGES } from "@openminutes/shared";
import {
  ArrowLeft,
  FileAudio,
  FileText,
  Loader2,
  RefreshCw,
  ScrollText,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge, isInProgress } from "../components/StatusBadge";
import { Alert } from "../components/ui/Alert";
import { AudioPlayer } from "../components/ui/AudioPlayer";
import { Button } from "../components/ui/Button";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { formatDateTime, formatFileSize, formatTimestamp } from "../lib/format";
import { cn } from "../lib/cn";
import type { Summary, SummaryGroup } from "../lib/types";

function languageLabel(code: string): string {
  return (
    TRANSCRIPTION_LANGUAGES.find((language) => language.code === code)?.label ??
    code
  );
}

function SummaryStatusBadge({ summary }: { summary?: Summary | null }) {
  const config = !summary
    ? { label: "Not generated", className: "bg-muted-foreground/10 text-muted-foreground", pulse: false }
    : summary.status === "completed"
      ? { label: "Summary ready", className: "bg-accent/15 text-accent", pulse: false }
      : summary.status === "processing"
        ? { label: "Summarizing", className: "bg-info/15 text-info", pulse: true }
        : summary.status === "failed"
          ? { label: "Summary failed", className: "bg-destructive/15 text-destructive", pulse: false }
          : { label: "Queued", className: "bg-muted-foreground/10 text-muted-foreground", pulse: true };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ring-1 ring-current/10",
        config.className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full bg-current", config.pulse && "animate-pulse")}
        aria-hidden
      />
      {config.label}
    </span>
  );
}

function hasProcessingSummary(groups?: SummaryGroup[]): boolean {
  return groups?.some((group) => group.latest.status === "processing") ?? false;
}

export function AudioSummaryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"summary" | "transcript">("summary");
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("default");
  const [selectedSummaryId, setSelectedSummaryId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["audio-summaries", id],
    queryFn: () => api.getAudioSummary(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const item = query.state.data;
      if (!item) return false;
      return isInProgress(item.status) ||
        item.summary?.status === "processing" ||
        hasProcessingSummary(item.summaries)
        ? 5000
        : false;
    },
  });

  const { data: summaryTemplates } = useQuery({
    queryKey: ["summary-templates"],
    queryFn: api.listSummaryTemplates,
  });

  const hasAudio = Boolean(data?.audioObjectKey);
  const {
    data: audioUrl,
    isPending: audioPending,
    isError: audioError,
  } = useQuery({
    queryKey: ["audio-summaries", id, "audio"],
    queryFn: async () => URL.createObjectURL(await api.fetchAudioSummaryBlob(id!)),
    enabled: Boolean(id) && hasAudio,
    staleTime: Infinity,
    gcTime: 0,
  });

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const retranscribeMutation = useMutation({
    mutationFn: () => api.retranscribeAudioSummary(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audio-summaries", id] });
      queryClient.invalidateQueries({ queryKey: ["audio-summaries"] });
    },
  });

  const summarizeMutation = useMutation({
    mutationFn: () => api.summarizeAudioSummary(id!, selectedTemplateKey),
    onSuccess: () => {
      setSelectedSummaryId(null);
      queryClient.invalidateQueries({ queryKey: ["audio-summaries", id] });
      queryClient.invalidateQueries({ queryKey: ["audio-summaries"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteAudioSummary(id!),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["audio-summaries", id] });
      queryClient.invalidateQueries({ queryKey: ["audio-summaries"] });
      navigate("/summaries", { replace: true });
    },
  });

  if (isPending) {
    return (
      <Card className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Loading audio summary...
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Alert tone="danger" role="alert" title="Unable to load audio summary">
        <p>
          {error instanceof ApiError && error.status === 404
            ? "Audio summary not found."
            : "The audio summary details could not be loaded."}
        </p>
        <Link to="/summaries" className="mt-1 inline-block underline">
          Back to summaries
        </Link>
      </Alert>
    );
  }

  const hasTranscript = data.transcript.length > 0;
  const canRetranscribe = ["completed", "failed", "transcription_skipped"].includes(
    data.status,
  );
  const summaryGroups = data.summaries ?? [];
  const selectedGroup =
    summaryGroups.find((group) => group.templateKey === selectedTemplateKey) ?? null;
  const selectedSummary =
    (selectedSummaryId
      ? selectedGroup?.history.find((summary) => summary.id === selectedSummaryId)
      : null) ??
    selectedGroup?.latest ??
    null;
  const selectedTemplateEnabled = Boolean(
    summaryTemplates?.some((template) => template.key === selectedTemplateKey),
  );
  const templateOptions = [
    ...(summaryTemplates ?? []).map((template) => ({
      key: template.key,
      name: template.name,
      enabled: true,
    })),
    ...summaryGroups
      .filter(
        (group) =>
          !(summaryTemplates ?? []).some((template) => template.key === group.templateKey),
      )
      .map((group) => ({
        key: group.templateKey,
        name: `${group.templateKey} (disabled)`,
        enabled: false,
      })),
  ];
  const canSummarize =
    hasTranscript &&
    selectedTemplateEnabled &&
    selectedGroup?.latest.status !== "processing" &&
    !isInProgress(data.status);

  function handleRetranscribe() {
    if (
      hasTranscript &&
      !window.confirm("The current transcript will be replaced. Continue?")
    ) {
      return;
    }
    retranscribeMutation.mutate();
  }

  return (
    <div>
      <Link
        to="/summaries"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All summaries
      </Link>

      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-bold tracking-tight">
                {data.title}
              </h1>
              <StatusBadge status={data.status} />
              <SummaryStatusBadge summary={selectedSummary ?? data.summary} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <FileAudio className="h-4 w-4 shrink-0" aria-hidden />
                {data.originalFilename}
              </span>
              <span className="tabular-nums">{formatFileSize(data.sizeBytes)}</span>
              <span>{languageLabel(data.language)}</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canRetranscribe && (
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
                {hasTranscript ? "Retranscribe" : "Create transcript"}
              </Button>
            )}
            <Button
              type="button"
              onClick={() => summarizeMutation.mutate()}
              disabled={!canSummarize || summarizeMutation.isPending}
              aria-busy={summarizeMutation.isPending}
              title={
                !hasTranscript
                  ? "Transcript is required before summary"
                  : !selectedTemplateEnabled
                    ? "This template is disabled"
                  : undefined
              }
            >
              {summarizeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              {selectedGroup?.latest.status === "completed" ? "Regenerate summary" : "Generate summary"}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => setDeleteOpen(true)}
              disabled={isInProgress(data.status) || deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete
            </Button>
          </div>
        </div>

        <div className="grid gap-3 border-t border-border bg-background px-5 py-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Created
            </p>
            <p className="mt-2 text-sm font-bold">{formatDateTime(data.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Last updated
            </p>
            <p className="mt-2 text-sm font-bold">{formatDateTime(data.updatedAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Transcript
            </p>
            <p className="mt-2 text-sm font-bold">{data.transcript.length} segments</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Summary model
            </p>
            <p className="mt-2 truncate text-sm font-bold">
              {selectedSummary?.model ?? "Not generated"}
            </p>
          </div>
        </div>
      </Card>

      <div className="mb-6 space-y-3">
        {data.error && (
          <Alert tone="danger" role="alert" title="Transcription error">
            {data.error}
          </Alert>
        )}
        {selectedSummary?.error && selectedSummary.status === "failed" && (
          <Alert tone="danger" role="alert" title="Summary error">
            {selectedSummary.error}
          </Alert>
        )}
        {retranscribeMutation.isError && (
          <Alert tone="danger" role="alert">
            {retranscribeMutation.error instanceof ApiError
              ? retranscribeMutation.error.message
              : "Unable to start transcription."}
          </Alert>
        )}
        {summarizeMutation.isError && (
          <Alert tone="danger" role="alert">
            {summarizeMutation.error instanceof ApiError
              ? summarizeMutation.error.message
              : "Unable to start summary generation."}
          </Alert>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Audio notes</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review the generated summary and the transcript behind it.
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
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_180px]">
                    <label className="text-sm font-semibold">
                      Template
                      <select
                        value={selectedTemplateKey}
                        onChange={(event) => {
                          setSelectedTemplateKey(event.target.value);
                          setSelectedSummaryId(null);
                        }}
                        className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {templateOptions.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-semibold">
                      Version
                      <select
                        value={selectedSummary?.id ?? ""}
                        onChange={(event) => setSelectedSummaryId(event.target.value)}
                        disabled={!selectedGroup}
                        className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {!selectedGroup && <option value="">No versions</option>}
                        {selectedGroup?.history.map((summary) => (
                          <option key={summary.id} value={summary.id}>
                            v{summary.version} · {formatDateTime(summary.createdAt)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <Button
                    type="button"
                    onClick={() => summarizeMutation.mutate()}
                    disabled={!canSummarize || summarizeMutation.isPending}
                    aria-busy={summarizeMutation.isPending}
                  >
                    {summarizeMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden />
                    )}
                    {selectedGroup?.latest.status === "completed"
                      ? "Regenerate summary"
                      : "Generate summary"}
                  </Button>
                </div>

                {selectedSummary?.status === "completed" && selectedSummary.content ? (
                  <article className="prose prose-sm max-w-none whitespace-pre-wrap rounded-lg bg-background p-4 text-sm leading-7 text-foreground">
                    {selectedSummary.content}
                  </article>
                ) : (
                  <EmptyState
                    icon={Sparkles}
                    title={
                      selectedSummary?.status === "processing"
                        ? "Summary is being generated"
                        : "Summary is not available yet"
                    }
                    description={
                      hasTranscript
                        ? "Generate a summary manually when you are ready."
                        : "Transcript must finish before summary generation."
                    }
                    action={
                      canSummarize ? (
                        <Button
                          type="button"
                          onClick={() => summarizeMutation.mutate()}
                          disabled={summarizeMutation.isPending}
                        >
                          {summarizeMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Sparkles className="h-4 w-4" aria-hidden />
                          )}
                          {selectedGroup?.latest.status === "completed"
                            ? "Regenerate summary"
                            : "Generate summary"}
                        </Button>
                      ) : undefined
                    }
                    className="min-h-[400px] border-0 bg-background"
                  />
                )}
              </div>
            ) : (
              <div className="p-4">
                {!hasTranscript ? (
                  <EmptyState
                    icon={ScrollText}
                    title="Transcript is not available yet"
                    description={
                      data.status === "transcription_skipped"
                        ? "Transcription was skipped because no provider is configured. Configure a provider to generate a transcript from this upload."
                        : data.status === "failed"
                          ? "Transcription failed, but the audio file is still available. You can retry anytime."
                          : isInProgress(data.status)
                            ? "The audio is still processing. This page updates automatically."
                            : "No transcript is available for this upload."
                    }
                    action={
                      canRetranscribe ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleRetranscribe}
                          disabled={retranscribeMutation.isPending}
                        >
                          <RefreshCw className="h-4 w-4" aria-hidden />
                          Create transcript
                        </Button>
                      ) : undefined
                    }
                    className="min-h-[400px] border-0 bg-background"
                  />
                ) : (
                  <ol className="space-y-3" aria-label="Transcript segments">
                    {data.transcript.map((segment) => (
                      <li
                        key={segment.id}
                        className="rounded-lg border border-border bg-background p-4"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold text-muted-foreground">
                          <span className="tabular-nums">
                            {formatTimestamp(segment.startMs)} -{" "}
                            {formatTimestamp(segment.endMs)}
                          </span>
                          {segment.speaker && (
                            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
                              {segment.speaker}
                            </span>
                          )}
                        </div>
                        <p className="text-sm leading-6">{segment.text}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileAudio className="h-5 w-5 text-muted-foreground" aria-hidden />
                Audio
              </CardTitle>
            </CardHeader>
            <div className="p-4">
              {audioPending ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading audio...
                </div>
              ) : audioError || !audioUrl ? (
                <Alert tone="warning">Audio file could not be loaded.</Alert>
              ) : (
                <AudioPlayer src={audioUrl} downloadName={data.originalFilename} />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
                Source
              </CardTitle>
            </CardHeader>
            <div className="space-y-3 p-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Filename
                </p>
                <p className="mt-1 break-words font-semibold">{data.originalFilename}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  MIME type
                </p>
                <p className="mt-1 font-semibold">{data.mimeType}</p>
              </div>
            </div>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this upload?"
        description={
          <p>
            This permanently removes{" "}
            <span className="font-semibold text-foreground">{data.title}</span>,
            including its audio file, transcript, and summary.
          </p>
        }
        confirmLabel={deleteMutation.isPending ? "Deleting..." : "Delete permanently"}
        confirmPhrase="DELETE"
        loading={deleteMutation.isPending}
        errorMessage={
          deleteMutation.isError
            ? deleteMutation.error instanceof ApiError
              ? deleteMutation.error.message
              : "Unable to delete the upload."
            : null
        }
        onConfirm={() => deleteMutation.mutate()}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setDeleteOpen(false);
            deleteMutation.reset();
          }
        }}
      />
    </div>
  );
}
