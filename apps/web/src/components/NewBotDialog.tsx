import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Bot,
  Loader2,
  MonitorPlay,
  Plus,
  Search,
  Images,
  X,
} from "lucide-react";
import { TRANSCRIPTION_LANGUAGES } from "@openminutes/shared";
import { api, ApiError } from "../lib/api";
import type { TranscriptionLanguage, TranscriptionMode } from "../lib/types";
import { Button } from "./ui/Button";
import { Field, Input, Select } from "./ui/Field";
import { Alert } from "./ui/Alert";
import { cn } from "../lib/cn";

function languageLabel(code: TranscriptionLanguage): string {
  return (
    TRANSCRIPTION_LANGUAGES.find((language) => language.code === code)?.label ??
    code
  );
}

const MINUTE_STEP = 5;
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function roundUpToStep(date: Date, stepMinutes = MINUTE_STEP): Date {
  const next = new Date(date);
  next.setSeconds(0, 0);
  const remainder = next.getMinutes() % stepMinutes;
  if (remainder > 0) {
    next.setMinutes(next.getMinutes() + stepMinutes - remainder);
  }
  return next;
}

function defaultScheduledDate(): Date {
  return roundUpToStep(new Date(Date.now() + 15 * 60 * 1000));
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isSameDay(first: Date, second: Date): boolean {
  return startOfDay(first).getTime() === startOfDay(second).getTime();
}

function isPastDay(date: Date): boolean {
  return startOfDay(date).getTime() < startOfDay(new Date()).getTime();
}

function setDatePart(value: Date, date: Date): Date {
  const next = new Date(value);
  next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return next;
}

function setTimePart(value: Date, hour: number, minute: number): Date {
  const next = new Date(value);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function formatScheduleSummary(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SchedulePicker({
  value,
  onChange,
}: {
  value: Date;
  onChange: (value: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(
    () => new Date(value.getFullYear(), value.getMonth(), 1),
  );
  const [minuteDraft, setMinuteDraft] = useState(String(value.getMinutes()));
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const selectedInPast = value.getTime() <= Date.now();
  const parsedMinute = Number(minuteDraft);
  const minuteInvalid =
    minuteDraft.trim() === "" ||
    !Number.isInteger(parsedMinute) ||
    parsedMinute < 0 ||
    parsedMinute > 59;
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const daysInMonth = new Date(
    viewMonth.getFullYear(),
    viewMonth.getMonth() + 1,
    0,
  ).getDate();
  const calendarDays = [
    ...Array.from({ length: firstDay.getDay() }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) =>
        new Date(viewMonth.getFullYear(), viewMonth.getMonth(), index + 1),
    ),
  ];

  const quickChoices = [
    {
      label: "In 15 min",
      getDate: () => roundUpToStep(new Date(Date.now() + 15 * 60 * 1000)),
    },
    {
      label: "In 30 min",
      getDate: () => roundUpToStep(new Date(Date.now() + 30 * 60 * 1000)),
    },
    {
      label: "In 1 hour",
      getDate: () => roundUpToStep(new Date(Date.now() + 60 * 60 * 1000)),
    },
    {
      label: "Tomorrow 9:00",
      getDate: () => {
        const next = new Date();
        next.setDate(next.getDate() + 1);
        next.setHours(9, 0, 0, 0);
        return next;
      },
    },
  ];

  function applyDate(date: Date) {
    const next = setDatePart(value, date);
    const safeNext = next.getTime() <= Date.now() ? defaultScheduledDate() : next;
    onChange(safeNext);
    setMinuteDraft(String(safeNext.getMinutes()));
  }

  function applyQuickChoice(date: Date) {
    onChange(date);
    setMinuteDraft(String(date.getMinutes()));
    setViewMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  function applyMinute(rawValue: string) {
    if (!/^\d{0,2}$/.test(rawValue)) return;
    setMinuteDraft(rawValue);

    const minute = Number(rawValue);
    if (rawValue.trim() !== "" && Number.isInteger(minute) && minute <= 59) {
      onChange(setTimePart(value, value.getHours(), minute));
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {quickChoices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            className="h-9 rounded-md border border-border px-2 text-xs font-bold text-muted-foreground transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => applyQuickChoice(choice.getDate())}
          >
            {choice.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_210px]">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
              aria-label="Previous month"
              onClick={() =>
                setViewMonth(
                  new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1),
                )
              }
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <p className="text-sm font-bold">{formatMonth(viewMonth)}</p>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
              aria-label="Next month"
              onClick={() =>
                setViewMonth(
                  new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1),
                )
              }
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {dayNames.map((day) => (
              <span
                key={day}
                className="py-1 text-[11px] font-bold uppercase text-muted-foreground"
              >
                {day}
              </span>
            ))}
            {calendarDays.map((date, index) =>
              date ? (
                <button
                  key={date.toISOString()}
                  type="button"
                  disabled={isPastDay(date)}
                  className={cn(
                    "h-9 rounded-md text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-30",
                    isSameDay(date, value)
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-surface-hover",
                    isSameDay(date, new Date()) &&
                      !isSameDay(date, value) &&
                      "ring-1 ring-accent/40",
                  )}
                  onClick={() => applyDate(date)}
                >
                  {date.getDate()}
                </button>
              ) : (
                <span key={`blank-${index}`} className="h-9" />
              ),
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field id="schedule-hour" label="Hour">
              <Select
                id="schedule-hour"
                value={String(value.getHours())}
                onChange={(event) =>
                  onChange(
                    setTimePart(value, Number(event.target.value), value.getMinutes()),
                  )
                }
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="schedule-minute" label="Minute">
              <Input
                id="schedule-minute"
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                step={1}
                required
                value={minuteDraft}
                onChange={(event) => applyMinute(event.target.value)}
                onBlur={() => {
                  if (!minuteInvalid) setMinuteDraft(String(parsedMinute));
                }}
                aria-invalid={minuteInvalid}
                className={minuteInvalid ? "border-destructive" : undefined}
              />
            </Field>
          </div>

          {minuteInvalid && (
            <p className="text-xs font-semibold text-destructive">
              Minute must be between 0 and 59.
            </p>
          )}

          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              selectedInPast
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-info/30 bg-info/10 text-foreground",
            )}
          >
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Bot join time
            </p>
            <p className="mt-1 font-bold">{formatScheduleSummary(value)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Timezone: {timezone}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LanguageCombobox({
  value,
  onChange,
}: {
  value: TranscriptionLanguage;
  onChange: (value: TranscriptionLanguage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = TRANSCRIPTION_LANGUAGES.filter((language) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
      language.label.toLowerCase().includes(needle) ||
      language.code.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="relative">
      <button
        type="button"
        id="transcription-language"
        className="flex h-11 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-left text-sm text-foreground transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-accent"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
      >
        <span>
          {languageLabel(value)}
          <span className="ml-2 text-xs font-semibold uppercase text-muted-foreground">
            {value}
          </span>
        </span>
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="border-b border-border p-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2">
              <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                autoFocus
                placeholder="Search language..."
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                }}
              />
            </div>
          </div>
          <div
            role="listbox"
            aria-labelledby="transcription-language"
            className="max-h-56 overflow-y-auto p-1"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No language found.
              </div>
            ) : (
              filtered.map((language) => (
                <button
                  type="button"
                  key={language.code}
                  role="option"
                  aria-selected={language.code === value}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                    language.code === value
                      ? "bg-accent/10 text-accent"
                      : "text-foreground hover:bg-surface-hover",
                  )}
                  onClick={() => {
                    onChange(language.code);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span>
                    {language.label}
                    <span className="ml-2 text-xs font-semibold uppercase text-muted-foreground">
                      {language.code}
                    </span>
                  </span>
                  {language.code === value && (
                    <Check className="h-4 w-4" aria-hidden />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function NewBotDialog() {
  const [open, setOpen] = useState(false);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [title, setTitle] = useState("");
  const [botName, setBotName] = useState("OpenMinutes Assistant");
  const [mode, setMode] = useState<TranscriptionMode>("post_meeting");
  const [language, setLanguage] = useState<TranscriptionLanguage>("id");
  const [captureScreenshots, setCaptureScreenshots] = useState(true);
  const [captureVideo, setCaptureVideo] = useState(false);
  const [joinTiming, setJoinTiming] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledDate);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: api.createBot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setOpen(false);
      setMeetingUrl("");
      setTitle("");
      setLanguage("id");
      setCaptureScreenshots(true);
      setCaptureVideo(false);
      setJoinTiming("now");
      setScheduledAt(defaultScheduledDate());
      setScheduleError(null);
    },
  });

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setScheduleError(null);
    const trimmedTitle = title.trim();
    const scheduledStartAt = joinTiming === "scheduled" ? scheduledAt : null;
    if (scheduledStartAt && scheduledStartAt.getTime() <= Date.now()) {
      setScheduleError("Choose a future date and time.");
      return;
    }
    mutation.mutate({
      meetingUrl: meetingUrl.trim(),
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
      mode,
      language,
      botName,
      captureScreenshots,
      captureVideo,
      ...(scheduledStartAt
        ? { scheduledStartAt: scheduledStartAt.toISOString() }
        : {}),
    });
  }

  function close() {
    if (!mutation.isPending) {
      setOpen(false);
      mutation.reset();
      setScheduleError(null);
    }
  }

  function openDialog() {
    setScheduledAt(defaultScheduledDate());
    setScheduleError(null);
    setOpen(true);
  }

  const submitLabel =
    joinTiming === "scheduled"
      ? mutation.isPending
        ? "Scheduling..."
        : "Schedule meeting"
      : mutation.isPending
        ? "Joining..."
        : "Join meeting";

  return (
    <>
      <Button type="button" onClick={openDialog}>
        <Plus className="h-4 w-4" aria-hidden />
        Join meeting
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={close}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-bot-title"
            className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-surface text-left shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Bot className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h2 id="new-bot-title" className="text-lg font-bold">
                    Join a meeting
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add OpenMinutes as a participant to capture audio and prepare the transcript.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={close}
                aria-label="Close dialog"
                className="h-9 w-9 shrink-0"
              >
                <X className="h-5 w-5" aria-hidden />
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6 text-left">
              <Field
                id="meeting-url"
                label={
                  <>
                    Meeting link <span className="text-destructive">*</span>
                  </>
                }
                hint="Supports Google Meet, Microsoft Teams, and Zoom."
              >
                <Input
                  id="meeting-url"
                  type="url"
                  required
                  autoFocus
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="https://meet.google.com/abc-defg-hij"
                />
              </Field>

              <Field
                id="meeting-title"
                label="Meeting name"
                hint="Optional. Leave blank to generate a professional name automatically."
              >
                <Input
                  id="meeting-title"
                  type="text"
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Weekly product review"
                />
              </Field>

              <Field
                id="bot-name"
                label="Bot participant name"
                hint="This is the name hosts and attendees see in the meeting."
              >
                <Input
                  id="bot-name"
                  type="text"
                  maxLength={60}
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                />
              </Field>

              <Field
                id="transcription-language"
                label="Transcription language"
                hint="Used by the selected transcription provider for this meeting."
              >
                <LanguageCombobox value={language} onChange={setLanguage} />
              </Field>

              <label
                htmlFor="capture-screenshots"
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors duration-200",
                  captureScreenshots
                    ? "border-accent bg-accent/10"
                    : "border-border hover:bg-surface-hover",
                )}
              >
                <input
                  id="capture-screenshots"
                  type="checkbox"
                  checked={captureScreenshots}
                  onChange={(event) => setCaptureScreenshots(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                />
                <span>
                  <span className="flex items-center gap-2 font-bold text-foreground">
                    <Images className="h-4 w-4 text-muted-foreground" aria-hidden />
                    Capture screenshots
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    Save visual snapshots when shared content changes during the meeting.
                  </span>
                </span>
              </label>

              <label
                htmlFor="capture-video"
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors duration-200",
                  captureVideo
                    ? "border-accent bg-accent/10"
                    : "border-border hover:bg-surface-hover",
                )}
              >
                <input
                  id="capture-video"
                  type="checkbox"
                  checked={captureVideo}
                  onChange={(event) => setCaptureVideo(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                />
                <span>
                  <span className="flex items-center gap-2 font-bold text-foreground">
                    <MonitorPlay className="h-4 w-4 text-muted-foreground" aria-hidden />
                    Record video
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    Save a playable MP4 of the meeting screen and audio. This uses more storage.
                  </span>
                </span>
              </label>

              <fieldset>
                <legend className="mb-1.5 text-sm font-semibold">
                  Join timing
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["now", "Join now", "Start the bot as soon as this form is submitted."],
                      ["scheduled", "Schedule", "Start the bot automatically at a future time."],
                    ] as const
                  ).map(([value, label, description]) => (
                    <label
                      key={value}
                      className={cn(
                        "cursor-pointer rounded-lg border p-3 text-sm transition-colors duration-200",
                        joinTiming === value
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <input
                        type="radio"
                        name="join-timing"
                        value={value}
                        checked={joinTiming === value}
                        onChange={() => setJoinTiming(value)}
                        className="sr-only"
                      />
                      <span className="flex items-center gap-2 font-bold">
                        {value === "scheduled" && (
                          <CalendarClock className="h-4 w-4" aria-hidden />
                        )}
                        {label}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {description}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {joinTiming === "scheduled" && (
                <Field
                  id="scheduled-start-at"
                  label="Scheduled join time"
                  hint="Pick when the bot should enter the meeting room."
                >
                  <SchedulePicker value={scheduledAt} onChange={setScheduledAt} />
                </Field>
              )}

              <fieldset>
                <legend className="mb-1.5 text-sm font-semibold">
                  Transcription mode
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["post_meeting", "After meeting", "Best for stable, long-form recordings."],
                      ["realtime", "Real-time", "Shows transcript while the meeting is active."],
                    ] as const
                  ).map(([value, label, description]) => (
                    <label
                      key={value}
                      className={cn(
                        "cursor-pointer rounded-lg border p-3 text-sm transition-colors duration-200",
                        mode === value
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <input
                        type="radio"
                        name="mode"
                        value={value}
                        checked={mode === value}
                        onChange={() => setMode(value)}
                        className="sr-only"
                      />
                      <span className="font-bold">{label}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {description}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {scheduleError && (
                <Alert tone="danger" role="alert">
                  {scheduleError}
                </Alert>
              )}

              {mutation.isError && (
                <Alert tone="danger" role="alert">
                  {mutation.error instanceof ApiError
                    ? mutation.error.message
                    : "Unable to join the meeting. Please try again."}
                </Alert>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  {submitLabel}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
