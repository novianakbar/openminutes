import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "./Button";
import { Alert } from "./Alert";
import { Field, Input } from "./Field";

type ConfirmTone = "danger" | "primary";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  errorMessage,
  confirmPhrase,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  loading?: boolean;
  errorMessage?: string | null;
  confirmPhrase?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  const isDanger = tone === "danger";
  const iconWrap = isDanger
    ? "bg-destructive/10 text-destructive"
    : "bg-accent/10 text-accent";
  const phraseMismatch = Boolean(confirmPhrase) && typed !== confirmPhrase;
  const confirmDisabled = loading || phraseMismatch;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!loading) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-xl border border-border bg-surface text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconWrap}`}
            >
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 id="confirm-dialog-title" className="text-lg font-bold">
                {title}
              </h2>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={loading}
            aria-label="Close dialog"
            className="h-9 w-9 shrink-0"
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>

        <div className="flex flex-col gap-4 p-6 text-sm leading-6 text-muted-foreground">
          <div>{description}</div>

          {confirmPhrase && (
            <Field
              id="confirm-dialog-phrase"
              label={
                <>
                  Type{" "}
                  <span className="font-mono text-destructive">
                    {confirmPhrase}
                  </span>{" "}
                  to confirm
                </>
              }
            >
              <Input
                id="confirm-dialog-phrase"
                type="text"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmPhrase}
                disabled={loading}
                aria-invalid={phraseMismatch}
              />
            </Field>
          )}

          {errorMessage && (
            <Alert tone="danger" role="alert">
              {errorMessage}
            </Alert>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={isDanger ? "danger" : "primary"}
              onClick={onConfirm}
              disabled={confirmDisabled}
              aria-busy={loading}
              title={
                phraseMismatch
                  ? `Type "${confirmPhrase}" exactly to confirm`
                  : undefined
              }
            >
              {loading && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
