import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Clock3,
  FileAudio,
  FileText,
  ListVideo,
  Loader2,
  Mic2,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { isInProgress } from "../components/StatusBadge";
import { StatusBadge } from "../components/StatusBadge";
import { NewBotDialog } from "../components/NewBotDialog";
import { EmptyState } from "../components/EmptyState";
import { formatDateTime, formatDuration } from "../lib/format";
import { PLATFORM_LABEL } from "../lib/platform";
import { PlatformIcon } from "../components/icons/PlatformIcons";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Input, Select } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { StatCard } from "../components/ui/StatCard";

const statusFilters = [
  ["all", "All statuses"],
  ["active", "Active"],
  ["scheduled", "Scheduled"],
  ["waiting_admission", "Awaiting approval"],
  ["processing_transcript", "Transcribing"],
  ["completed", "Completed"],
  ["failed", "Failed"],
] as const;

const PAGE_SIZE = 10;
const TRANSCRIPT_STUCK_MS = 10 * 60 * 1000;

function getAttention(meeting: {
  status: string;
  error: string | null;
  updatedAt: string;
  scheduledStartAt: string | null;
}) {
  if (meeting.status === "failed") {
    return {
      label: "Failed",
      detail: meeting.error ?? "Review meeting details",
      tone: "text-destructive bg-destructive/10",
    };
  }
  if (meeting.status === "waiting_admission") {
    return {
      label: "Needs approval",
      detail: "Host approval required",
      tone: "text-warning bg-warning/10",
    };
  }
  if (meeting.status === "scheduled") {
    return {
      label: "Scheduled",
      detail: meeting.scheduledStartAt
        ? formatDateTime(meeting.scheduledStartAt)
        : "Waiting for scheduled time",
      tone: "text-info bg-info/10",
    };
  }
  if (
    meeting.status === "processing_transcript" &&
    Date.now() - new Date(meeting.updatedAt).getTime() > TRANSCRIPT_STUCK_MS
  ) {
    return {
      label: "Check transcription",
      detail: "No recent progress",
      tone: "text-warning bg-warning/10",
    };
  }
  return {
    label: "No action",
    detail: "Up to date",
    tone: "text-muted-foreground bg-muted-foreground/10",
  };
}

export function MeetingsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof statusFilters)[number][0]>("all");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(
    null,
  );
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteMeeting(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ["meetings", id] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setDeleteTarget(null);
    },
  });

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["meetings", { page, pageSize: PAGE_SIZE, search, statusFilter }],
    queryFn: () =>
      api.listMeetings({
        page,
        pageSize: PAGE_SIZE,
        search: search.trim(),
        status: statusFilter,
      }),
    // Poll lebih rapat selama ada bot yang masih jalan/diproses
    refetchInterval: (query) =>
      query.state.data?.items.some((m) => isInProgress(m.status)) ? 5000 : 30000,
  });

  useEffect(() => {
    if (data && data.page !== page) setPage(data.page);
  }, [data, page]);

  const meetings = data?.items ?? [];
  const stats = data?.stats ?? {
    total: 0,
    active: 0,
    waiting: 0,
    transcribing: 0,
  };
  const startItem = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const endItem = data ? Math.min(data.page * data.pageSize, data.total) : 0;
  const hasFilters = search.trim() !== "" || statusFilter !== "all";

  return (
    <div>
      <PageHeader
        title="Meetings"
        description="Join meetings, track recording status, and review transcripts from one workspace."
        action={<NewBotDialog />}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ListVideo} label="Total" value={stats.total} hint="All meetings" />
        <StatCard icon={Mic2} label="Active" value={stats.active} hint="Session in progress" />
        <StatCard
          icon={ShieldAlert}
          label="Approval"
          value={stats.waiting}
          hint="Waiting for host"
        />
        <StatCard
          icon={Clock3}
          label="Transcribing"
          value={stats.transcribing}
          hint="Processing audio"
        />
      </div>

      {isPending && (
        <Card className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Loading meetings...
        </Card>
      )}

      {isError && (
        <Alert tone="danger" role="alert" title="Unable to load meetings">
          {error instanceof ApiError && error.status === 401
            ? "Your session has expired. Please sign in again."
            : "The API is currently unreachable. Please check the server status."}
        </Alert>
      )}

      {data && data.stats.total === 0 && (
        <EmptyState
          icon={ListVideo}
          title="No meetings yet"
          description="Join your first Google Meet or Microsoft Teams session to start recording."
          action={<NewBotDialog />}
        />
      )}

      {data && data.stats.total > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-bold">Meeting history</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.total > 0
                  ? `Showing ${startItem}-${endItem} of ${data.total} meetings`
                  : hasFilters
                    ? "No meetings match the current filters"
                    : "No meetings to display"}
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
                  placeholder="Search name, meeting ID, platform, or link"
                  className="pl-9"
                  aria-label="Search meetings"
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

          {meetings.length === 0 ? (
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
                    <th className="px-4 py-3 font-bold">Meeting</th>
                    <th className="px-4 py-3 font-bold">Attention</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Assets</th>
                    <th className="px-4 py-3 font-bold">Last activity</th>
                    <th className="px-4 py-3 font-bold text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.map((meeting) => {
                    const attention = getAttention(meeting);
                    return (
                      <tr
                        key={meeting.id}
                        className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-hover"
                      >
                        <td className="px-4 py-4">
                          <Link
                            to={`/meetings/${meeting.id}`}
                            className="font-bold transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            {meeting.title}
                          </Link>
                          <p className="mt-1 flex max-w-sm flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <PlatformIcon
                                platform={meeting.platform}
                                className="h-3.5 w-3.5 shrink-0"
                              />
                              {PLATFORM_LABEL[meeting.platform] ?? meeting.platform}
                            </span>
                            <span className="max-w-[180px] truncate">
                              Bot: {meeting.botName}
                            </span>
                            <span className="max-w-[220px] truncate tabular-nums">
                              Meeting ID: {meeting.externalMeetingId}
                            </span>
                            {meeting.scheduledStartAt && (
                              <span className="max-w-[240px] truncate tabular-nums">
                                Scheduled: {formatDateTime(meeting.scheduledStartAt)}
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${attention.tone}`}
                          >
                            {attention.label !== "No action" && (
                              <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                            )}
                            {attention.label}
                          </span>
                          <p className="mt-1 max-w-44 truncate text-xs text-muted-foreground">
                            {attention.detail}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={meeting.status} />
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">
                          <div className="flex flex-col gap-1.5">
                            <span className="inline-flex items-center gap-2 text-xs">
                              <FileAudio className="h-3.5 w-3.5" aria-hidden />
                              {meeting.audioObjectKey ? "Recording" : "No recording"}
                              {meeting.durationSec != null && (
                                <span className="tabular-nums">
                                  {formatDuration(meeting.durationSec)}
                                </span>
                              )}
                            </span>
                            <span className="inline-flex items-center gap-2 text-xs">
                              <FileText className="h-3.5 w-3.5" aria-hidden />
                              {meeting.transcriptCount ?? 0} transcript segments
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground tabular-nums">
                          {meeting.status === "scheduled" && meeting.scheduledStartAt
                            ? formatDateTime(meeting.scheduledStartAt)
                            : formatDateTime(meeting.updatedAt)}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setDeleteTarget({
                                id: meeting.id,
                                title: meeting.title,
                              })
                            }
                            disabled={isInProgress(meeting.status)}
                            title={
                              isInProgress(meeting.status)
                                ? "Stop the session before deleting"
                                : "Delete meeting"
                            }
                            aria-label={`Delete ${meeting.title}`}
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

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this meeting?"
        description={
          <div className="space-y-3">
            <p>
              This action is permanent and cannot be undone. Deleting
              {deleteTarget ? (
                <>
                  {" "}
                  <span className="font-semibold text-foreground">
                    {deleteTarget.title}
                  </span>{" "}
                </>
              ) : (
                " this meeting "
              )}
              will also remove:
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
