import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import type { SummarySettings } from "@openminutes/shared";
import { api } from "../../lib/api";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";

const emptySettings: SummarySettings = {
  apiKey: null,
  baseUrl: null,
  model: null,
};

export function SummarySettingsPage() {
  const [form, setForm] = useState<SummarySettings>(emptySettings);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["summary-settings"],
    queryFn: api.getSummarySettings,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: api.saveSummarySettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["summary-settings"], data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate({
      apiKey: form.apiKey?.trim() || null,
      baseUrl: form.baseUrl?.trim() || null,
      model: form.model?.trim() || null,
    });
  }

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
        title="AI Summary"
        description="Configure the OpenAI-compatible chat completion provider used for manual summary generation."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-muted-foreground" aria-hidden />
            Summary provider
          </CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <Field
            id="summary-base-url"
            label="Base URL"
            hint="Example: https://api.openai.com/v1 or http://localhost:11434/v1"
          >
            <Input
              id="summary-base-url"
              type="url"
              required
              placeholder="https://api.openai.com/v1"
              value={form.baseUrl ?? ""}
              onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            />
          </Field>

          <Field
            id="summary-api-key"
            label={
              <>
                API key{" "}
                <span className="font-normal text-muted-foreground">
                  (optional for local servers)
                </span>
              </>
            }
          >
            <Input
              id="summary-api-key"
              type="password"
              autoComplete="off"
              placeholder="sk-..."
              value={form.apiKey ?? ""}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            />
          </Field>

          <Field id="summary-model" label="Model">
            <Input
              id="summary-model"
              required
              placeholder="gpt-4o-mini"
              value={form.model ?? ""}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
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
