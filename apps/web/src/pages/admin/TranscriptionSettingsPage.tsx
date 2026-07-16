import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Mic } from "lucide-react";
import type { TranscriptionSettings } from "@openminutes/shared";
import { api } from "../../lib/api";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field, Input, Select } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";

const emptySettings: TranscriptionSettings = {
  provider: "deepgram",
  apiKey: null,
  baseUrl: null,
  model: null,
  language: "id",
};

export function TranscriptionSettingsPage() {
  const [form, setForm] = useState<TranscriptionSettings>(emptySettings);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["transcription-settings"],
    queryFn: api.getTranscriptionSettings,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: api.saveTranscriptionSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["transcription-settings"], data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({
      ...form,
      apiKey: form.apiKey?.trim() || null,
      baseUrl: form.baseUrl?.trim() || null,
      model: form.model?.trim() || null,
    });
  }

  const isOpenai = form.provider === "openai_compatible";

  if (isPending) {
    return (
      <Card className="flex justify-center p-10">
        <LoaderCircle
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-label="Loading"
        />
      </Card>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Transcription"
        description="Configure the speech-to-text provider for future transcription jobs."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mic className="h-5 w-5 text-muted-foreground" aria-hidden />
            Transcription provider
          </CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <Field id="provider" label="Provider">
            <Select
              id="provider"
              value={form.provider}
              onChange={(e) =>
                setForm({
                  ...form,
                  provider: e.target.value as TranscriptionSettings["provider"],
                })
              }
            >
              <option value="deepgram">Deepgram (with speaker diarization)</option>
              <option value="openai_compatible">
                OpenAI-compatible (OpenAI / Groq / local Whisper)
              </option>
            </Select>
          </Field>

          {isOpenai && (
            <Field
              id="base-url"
              label="Base URL"
              hint="Example: https://api.openai.com/v1 or http://localhost:8000/v1"
            >
              <Input
                id="base-url"
                type="url"
                required
                placeholder="https://api.openai.com/v1"
                value={form.baseUrl ?? ""}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </Field>
          )}

          <Field
            id="stt-api-key"
            label={
              <>
                API key{" "}
                <span className="font-normal text-muted-foreground">
                  {isOpenai ? "(optional for local servers)" : ""}
                </span>
              </>
            }
          >
            <Input
              id="stt-api-key"
              type="password"
              autoComplete="off"
              placeholder={isOpenai ? "sk-..." : "Deepgram API key"}
              value={form.apiKey ?? ""}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </Field>

          <Field id="model" label="Model">
            <Input
              id="model"
              placeholder={isOpenai ? "whisper-1" : "nova-2"}
              value={form.model ?? ""}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </Field>

          {save.isError && (
            <Alert tone="danger" role="alert">
              {save.error.message}
            </Alert>
          )}

          <Button type="submit" disabled={save.isPending} size="lg">
            {save.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : saved ? (
              <Check className="h-4 w-4" aria-hidden />
            ) : null}
            {saved ? "Saved" : "Save changes"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
