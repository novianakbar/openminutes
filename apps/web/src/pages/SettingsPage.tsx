import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { authClient } from "../lib/auth";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Field, Input } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";

export function SettingsPage() {
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data: keys, isPending } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data, error } = await authClient.apiKey.list();
      if (error) throw new Error(error.message ?? "Unable to load API keys");
      return data?.apiKeys ?? [];
    },
  });

  const createKey = useMutation({
    mutationFn: async (keyName: string) => {
      const { data, error } = await authClient.apiKey.create({ name: keyName });
      if (error) throw new Error(error.message ?? "Unable to create API key");
      return data;
    },
    onSuccess: (data) => {
      setCreatedKey(data?.key ?? null);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const deleteKey = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await authClient.apiKey.delete({ keyId });
      if (error) throw new Error(error.message ?? "Unable to delete API key");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) createKey.mutate(name.trim());
  }

  async function copyKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        description={
          <>
            Create API keys for programmatic access. Send requests with the{" "}
            <code className="rounded bg-surface-hover px-1 py-0.5">x-api-key</code>.
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-5 w-5 text-muted-foreground" aria-hidden />
              Create API key
            </CardTitle>
          </CardHeader>
          <form onSubmit={handleCreate} className="p-5">
            <Field
              id="key-name"
              label="Key name"
              hint="Use a clear name, for example curl-laptop."
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="curl-laptop"
                />
                <Button
                  type="submit"
                  disabled={createKey.isPending || !name.trim()}
                  size="lg"
                  className="shrink-0"
                >
                  {createKey.isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden />
                  )}
                  Create
                </Button>
              </div>
            </Field>

            {createKey.isError && (
              <Alert tone="danger" role="alert" className="mt-4">
                {createKey.error.message}
              </Alert>
            )}

            {createdKey && (
              <Alert tone="success" className="mt-4" title="API key created">
                <p>Copy it now. This key is shown only once.</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 text-xs text-foreground">
                    {createdKey}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={copyKey}
                    aria-label="Copy API key"
                    className="h-8 w-8 shrink-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-accent" aria-hidden />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                </div>
              </Alert>
            )}
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your API keys</CardTitle>
          </CardHeader>
          {isPending ? (
            <div className="flex justify-center p-8">
              <LoaderCircle
                className="h-5 w-5 animate-spin text-muted-foreground"
                aria-label="Loading"
              />
            </div>
          ) : !keys?.length ? (
            <p className="p-5 text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {k.name ?? "(unnamed)"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <code>{k.start ?? "an_"}...</code> · created{" "}
                      {new Date(k.createdAt).toLocaleDateString("id-ID")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteKey.mutate(k.id)}
                    disabled={deleteKey.isPending}
                    aria-label={`Delete key ${k.name ?? k.id}`}
                    className="h-9 w-9 shrink-0 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
