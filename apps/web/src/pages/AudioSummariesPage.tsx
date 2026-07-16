import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { TRANSCRIPTION_LANGUAGES, type TranscriptionLanguage } from "@openminutes/shared";
import {
  AlertCircle,
  CheckCircle2,
  FileAudio,
  FileText,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge, isInProgress } from "../components/StatusBadge";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Field, Input, Select, inputClass } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { StatCard } from "../components/ui/StatCard";
import { formatDateTime, formatFileSize } from "../lib/format";
import { cn } from "../lib/cn";
import type { AudioSummary, Summary } from "../lib/types";

const PAGE_SIZE = 10;
const statusFilters = [
  ["all", "All statuses"],
  ["processing_transcript", "Transcribing"],
  ["completed", "Completed"],
  ["transcription_skipped", "Transcript skipped"],
  ["failed", "Failed"],
] as const;

function SummaryStatusBadge({ summary }: { summary?: Summary | null }) {
  if (!summary) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted-foreground/10 px-2.5 py-1 text-xs font-bold text-muted-foreground ring-1 ring-current/10">
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
        Not generated
      </span>
    );
  }

  const config =
    summary.status === "completed"
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

function UploadDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<TranscriptionLanguage>("id");

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Choose an audio file first.");
      return api.uploadAudioSummary({
        file,
        title,
        language,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["audio-summaries"] });
      onClose();
      navigate(`/summaries/${data.id}`);
    },
  });

  useEffect(() => {
    if (!open) {
      setFile(null);
      setTitle("");
      setLanguage("id");
      uploadMutation.reset();
    }
  }, [open]);

  if (!open) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    uploadMutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!uploadMutation.isPending) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-audio-title"
        className="w-full max-w-lg rounded-xl border border-border bg-surface text-left shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Upload className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 id="upload-audio-title" className="text-lg font-bold">
                Upload audio
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Transcription starts automatically after upload.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={uploadMutation.isPending}
            aria-label="Close dialog"
            className="h-9 w-9 shrink-0"
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <Field id="audio-file" label="Audio file" hint="Maximum upload size is 250 MB.">
            <input
              id="audio-file"
              type="file"
              accept="audio/*"
              required
              className={inputClass}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>

          <Field id="audio-title" label="Title" hint="Optional. Filename is used when empty.">
            <Input
              id="audio-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Customer interview, product demo, voice note..."
              maxLength={120}
            />
          </Field>

          <Field id="audio-language" label="Transcript language">
            <Select
              id="audio-language"
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as TranscriptionLanguage)
              }
            >
              {TRANSCRIPTION_LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>

          {uploadMutation.isError && (
            <Alert tone="danger" role="alert">
              {uploadMutation.error instanceof ApiError
                ? uploadMutation.error.message
                : uploadMutation.error.message}
            </Alert>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={uploadMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!file || uploadMutation.isPending}
              aria-busy={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              Upload
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function getAttention(item: AudioSummary) {
  if (item.status === "failed") {
    return {
      label: "Failed",
      detail: item.error ?? "Review details",
      tone: "text-destructive bg-destructive/10",
    };
  }
  if (item.status === "transcription_skipped") {
    return {
      label: "Needs provider",
      detail: "Configure transcription, then retry",
      tone: "text-warning bg-warning/10",
    };
  }
  if (item.summary?.status === "failed") {
    return {
      label: "Summary failed",
      detail: item.summary.error ?? "Retry from detail",
      tone: "text-destructive bg-destructive/10",
    };
  }
  if (item.status === "completed" && !item.summary) {
    return {
      label: "Ready",
      detail: "Generate summary manually",
      tone: "text-accent bg-accent/10",
    };
  }
  return {
    label: "No action",
    detail: "Up to date",
    tone: "text-muted-foreground bg-muted-foreground/10",
  };
}

export function AudioSummariesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof statusFilters)[number][0]>("all");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AudioSummary | null>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAudioSummary(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ["audio-summaries", id] });
      queryClient.invalidateQueries({ queryKey: ["audio-summaries"] });
      setDeleteTarget(null);
    },
  });

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["audio-summaries", { page, pageSize: PAGE_SIZE, search, statusFilter }],
    queryFn: () =>
      api.listAudioSummaries({
        page,
        pageSize: PAGE_SIZE,
        search: search.trim(),
        status: statusFilter,
      }),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (item) => isInProgress(item.status) || item.summary?.status === "processing",
      )
        ? 5000
        : 30000,
  });

  useEffect(() => {
    if (data && data.page !== page) setPage(data.page);
  }, [data, page]);

  const items = data?.items ?? [];
  const stats = data?.stats ?? { total: 0, transcribing: 0, completed: 0 };
  const startItem = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const endItem = data ? Math.min(data.page * data.pageSize, data.total) : 0;
  const hasFilters = search.trim() !== "" || statusFilter !== "all";

  return (
    <div>
      <PageHeader
        title="Summaries"
        description="Upload audio, let OpenMinutes prepare the transcript, then generate a summary when you are ready."
        action={
          <Button type="button" onClick={() => setUploadOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Upload audio
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={FileAudio} label="Uploads" value={stats.total} hint="Audio files" />
        <StatCard
          icon={Loader2}
          label="Transcribing"
          value={stats.transcribing}
          hint="Processing audio"
        />
        <StatCard
          icon={FileText}
          label="Transcripts"
          value={stats.completed}
          hint="Ready for summary"
        />
        <StatCard
          icon={Sparkles}
          label="Summaries"
          value={items.filter((item) => item.summary?.status === "completed").length}
          hint="On this page"
        />
      </div>

      {isPending && (
        <Card className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Loading summaries...
        </Card>
      )}

      {isError && (
        <Alert tone="danger" role="alert" title="Unable to load summaries">
          {error instanceof ApiError && error.status === 401
            ? "Your session has expired. Please sign in again."
            : "The API is currently unreachable. Please check the server status."}
        </Alert>
      )}

      {data && data.stats.total === 0 && (
        <EmptyState
          icon={FileAudio}
          title="No audio uploads yet"
          description="Upload an audio file to create a transcript first. Summary generation stays manual."
          action={
            <Button type="button" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden />
              Upload audio
            </Button>
          }
        />
      )}

      {data && data.stats.total > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-bold">Audio summary library</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.total > 0
                  ? `Showing ${startItem}-${endItem} of ${data.total} uploads`
                  : hasFilters
                    ? "No uploads match the current filters"
                    : "No uploads to display"}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px]">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title or filename"
                  className="pl-9"
                  aria-label="Search summaries"
                />
              </div>
              <Select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as typeof statusFilter)
                }
                aria-label="Filter by status"
              >
                {statusFilters.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No results found"
              description="Adjust the search query or status filter."
              className="m-4"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-background text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    <th className="px-4 py-3 font-bold">Audio</th>
                    <th className="px-4 py-3 font-bold">Attention</th>
                    <th className="px-4 py-3 font-bold">Transcript</th>
                    <th className="px-4 py-3 font-bold">Summary</th>
                    <th className="px-4 py-3 font-bold">Last activity</th>
                    <th className="px-4 py-3 font-bold text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const attention = getAttention(item);
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-hover"
                      >
                        <td className="px-4 py-4">
                          <Link
                            to={`/summaries/${item.id}`}
                            className="font-bold transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            {item.title}
                          </Link>
                          <p className="mt-1 flex max-w-sm flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span className="max-w-[220px] truncate">
                              {item.originalFilename}
                            </span>
                            <span className="tabular-nums">
                              {formatFileSize(item.sizeBytes)}
                            </span>
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${attention.tone}`}
                          >
                            {attention.label === "No action" ? (
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                            )}
                            {attention.label}
                          </span>
                          <p className="mt-1 max-w-44 truncate text-xs text-muted-foreground">
                            {attention.detail}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1.5">
                            <StatusBadge status={item.status} />
                            <span className="text-xs text-muted-foreground">
                              {item.transcriptCount ?? 0} segments
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <SummaryStatusBadge summary={item.summary} />
                        </td>
                        <td className="px-4 py-4 text-muted-foreground tabular-nums">
                          {formatDateTime(item.updatedAt)}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(item)}
                            disabled={isInProgress(item.status)}
                            title={
                              isInProgress(item.status)
                                ? "Wait for transcription before deleting"
                                : "Delete upload"
                            }
                            aria-label={`Delete ${item.title}`}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Page {data.page} of {data.totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={data.page <= 1 || isPending}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setPage((value) => Math.min(data.totalPages, value + 1))
                }
                disabled={data.page >= data.totalPages || isPending}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this upload?"
        description={
          <div className="space-y-3">
            <p>
              This permanently removes{" "}
              <span className="font-semibold text-foreground">
                {deleteTarget?.title ?? "this upload"}
              </span>{" "}
              and all generated assets.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-foreground">
              <li>Audio file</li>
              <li>Transcript</li>
              <li>Summary</li>
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
              : "Unable to delete the upload."
            : null
        }
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setDeleteTarget(null);
            deleteMutation.reset();
          }
        }}
      />
    </div>
  );
}
