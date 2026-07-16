import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Bot, Loader2, Plus, Search, X } from "lucide-react";
import { TRANSCRIPTION_LANGUAGES } from "@openminutes/shared";
import { api, ApiError } from "../lib/api";
import type { TranscriptionLanguage, TranscriptionMode } from "../lib/types";
import { Button } from "./ui/Button";
import { Field, Input } from "./ui/Field";
import { Alert } from "./ui/Alert";
import { cn } from "../lib/cn";

function languageLabel(code: TranscriptionLanguage): string {
  return (
    TRANSCRIPTION_LANGUAGES.find((language) => language.code === code)?.label ??
    code
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
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: api.createBot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setOpen(false);
      setMeetingUrl("");
      setTitle("");
      setLanguage("id");
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
    const trimmedTitle = title.trim();
    mutation.mutate({
      meetingUrl: meetingUrl.trim(),
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
      mode,
      language,
      botName,
    });
  }

  function close() {
    if (!mutation.isPending) {
      setOpen(false);
      mutation.reset();
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
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
            className="w-full max-w-lg rounded-xl border border-border bg-surface text-left shadow-xl"
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
                  {mutation.isPending ? "Joining..." : "Join meeting"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
