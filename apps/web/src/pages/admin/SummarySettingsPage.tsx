import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { SummarySettings } from "@openminutes/shared";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { SummaryTemplate } from "../../lib/types";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field, Input, inputClass } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";

const emptySettings: SummarySettings = {
  apiKey: null,
  baseUrl: null,
  model: null,
};

type TemplateForm = {
  key: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  enabled: boolean;
  sortOrder: number;
};

const emptyTemplate: TemplateForm = {
  key: "",
  name: "",
  description: "",
  systemPrompt: "You create concise, useful summaries. Return markdown only.",
  userPrompt: "Create a summary from the transcript.",
  enabled: true,
  sortOrder: 100,
};

function toTemplateForm(template: SummaryTemplate): TemplateForm {
  return {
    key: template.key,
    name: template.name,
    description: template.description,
    systemPrompt: template.systemPrompt,
    userPrompt: template.userPrompt,
    enabled: template.enabled,
    sortOrder: template.sortOrder,
  };
}

export function SummarySettingsPage() {
  const [form, setForm] = useState<SummarySettings>(emptySettings);
  const [saved, setSaved] = useState(false);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(emptyTemplate);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["summary-settings"],
    queryFn: api.getSummarySettings,
  });
  const {
    data: templates,
    isPending: templatesPending,
    isError: templatesError,
  } = useQuery({
    queryKey: ["summary-templates", "admin"],
    queryFn: api.listAdminSummaryTemplates,
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

  const saveTemplate = useMutation({
    mutationFn: (input: TemplateForm) => {
      const payload = {
        name: input.name.trim(),
        description: input.description.trim(),
        systemPrompt: input.systemPrompt.trim(),
        userPrompt: input.userPrompt.trim(),
        enabled: input.enabled,
        sortOrder: Number(input.sortOrder) || 0,
      };
      if (editingKey) {
        return api.updateSummaryTemplate(editingKey, payload);
      }
      return api.createSummaryTemplate({
        key: input.key.trim(),
        ...payload,
      });
    },
    onSuccess: (template) => {
      queryClient.invalidateQueries({ queryKey: ["summary-templates"] });
      setEditingKey(template.key);
      setTemplateForm(toTemplateForm(template));
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: api.deleteSummaryTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["summary-templates"] });
      setEditingKey(null);
      setTemplateForm(emptyTemplate);
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

  function handleTemplateSubmit(event: FormEvent) {
    event.preventDefault();
    saveTemplate.mutate(templateForm);
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
    <div className="max-w-5xl">
      <PageHeader
        title="AI Summary"
        description="Configure the OpenAI-compatible provider and global summary templates."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
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
                  onChange={(event) =>
                    setForm({ ...form, baseUrl: event.target.value })
                  }
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
                  onChange={(event) =>
                    setForm({ ...form, apiKey: event.target.value })
                  }
                />
              </Field>

              <Field id="summary-model" label="Model">
                <Input
                  id="summary-model"
                  required
                  placeholder="gpt-4o-mini"
                  value={form.model ?? ""}
                  onChange={(event) =>
                    setForm({ ...form, model: event.target.value })
                  }
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

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Summary Templates</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Templates are global and available to all users when enabled.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditingKey(null);
                  setTemplateForm(emptyTemplate);
                  saveTemplate.reset();
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                New template
              </Button>
            </CardHeader>

            <form onSubmit={handleTemplateSubmit} className="space-y-4 p-5">
              <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                <Field
                  id="template-key"
                  label="Key"
                  hint="Lowercase letters, numbers, dash, underscore."
                >
                  <Input
                    id="template-key"
                    required
                    disabled={Boolean(editingKey)}
                    value={templateForm.key}
                    onChange={(event) =>
                      setTemplateForm({ ...templateForm, key: event.target.value })
                    }
                    placeholder="sales_call"
                  />
                </Field>
                <Field id="template-name" label="Name">
                  <Input
                    id="template-name"
                    required
                    value={templateForm.name}
                    onChange={(event) =>
                      setTemplateForm({ ...templateForm, name: event.target.value })
                    }
                    placeholder="Sales Call"
                  />
                </Field>
              </div>

              <Field id="template-description" label="Description">
                <Input
                  id="template-description"
                  value={templateForm.description}
                  onChange={(event) =>
                    setTemplateForm({
                      ...templateForm,
                      description: event.target.value,
                    })
                  }
                  placeholder="What this template is best for"
                />
              </Field>

              <Field id="template-system-prompt" label="System prompt">
                <textarea
                  id="template-system-prompt"
                  required
                  rows={4}
                  value={templateForm.systemPrompt}
                  onChange={(event) =>
                    setTemplateForm({
                      ...templateForm,
                      systemPrompt: event.target.value,
                    })
                  }
                  className={cn(inputClass, "h-auto resize-y py-3 leading-6")}
                />
              </Field>

              <Field
                id="template-user-prompt"
                label="User prompt"
                hint="OpenMinutes automatically appends title, language, and transcript context."
              >
                <textarea
                  id="template-user-prompt"
                  required
                  rows={7}
                  value={templateForm.userPrompt}
                  onChange={(event) =>
                    setTemplateForm({
                      ...templateForm,
                      userPrompt: event.target.value,
                    })
                  }
                  className={cn(inputClass, "h-auto resize-y py-3 leading-6")}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={templateForm.enabled}
                    onChange={(event) =>
                      setTemplateForm({
                        ...templateForm,
                        enabled: event.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-accent"
                  />
                  Enabled
                </label>
                <Field id="template-sort-order" label="Sort order">
                  <Input
                    id="template-sort-order"
                    type="number"
                    min={0}
                    max={10000}
                    value={templateForm.sortOrder}
                    onChange={(event) =>
                      setTemplateForm({
                        ...templateForm,
                        sortOrder: Number(event.target.value),
                      })
                    }
                    className="w-32"
                  />
                </Field>
              </div>

              {saveTemplate.isError && (
                <Alert tone="danger" role="alert">
                  {saveTemplate.error.message}
                </Alert>
              )}

              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <Button
                  type="button"
                  variant="danger"
                  disabled={!editingKey || deleteTemplate.isPending}
                  onClick={() => {
                    if (
                      editingKey &&
                      window.confirm("Delete this summary template?")
                    ) {
                      deleteTemplate.mutate(editingKey);
                    }
                  }}
                >
                  {deleteTemplate.isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden />
                  )}
                  Delete
                </Button>
                <Button type="submit" disabled={saveTemplate.isPending}>
                  {saveTemplate.isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden />
                  )}
                  {editingKey ? "Save template" : "Create template"}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <aside>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Templates</CardTitle>
            </CardHeader>
            {templatesPending ? (
              <div className="flex justify-center p-8">
                <LoaderCircle
                  className="h-5 w-5 animate-spin text-muted-foreground"
                  aria-label="Loading"
                />
              </div>
            ) : templatesError ? (
              <Alert tone="danger" className="m-4">
                Unable to load templates.
              </Alert>
            ) : !templates?.length ? (
              <p className="p-4 text-sm text-muted-foreground">
                No templates yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {templates.map((template) => (
                  <li key={template.key} className="p-4">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(template.key);
                        setTemplateForm(toTemplateForm(template));
                        saveTemplate.reset();
                      }}
                      className="w-full cursor-pointer rounded-lg text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <div className="p-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-bold">{template.name}</p>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-bold",
                              template.enabled
                                ? "bg-accent/10 text-accent"
                                : "bg-muted-foreground/10 text-muted-foreground",
                            )}
                          >
                            {template.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {template.key} · order {template.sortOrder}
                        </p>
                        {template.description && (
                          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                            {template.description}
                          </p>
                        )}
                        {editingKey === template.key && (
                          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-accent">
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            Editing
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
