import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, LoaderCircle, Plus, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { authClient } from "../../lib/auth";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field, Input, Select } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";

export function UsersPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "user" as "user" | "admin",
  });
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  const { data, isPending, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await authClient.admin.listUsers({
        query: { limit: 100, sortBy: "createdAt", sortDirection: "desc" },
      });
      if (error) throw new Error(error.message ?? "Unable to load users");
      return data;
    },
  });

  const createUser = useMutation({
    mutationFn: async (input: typeof form) => {
      const { error } = await authClient.admin.createUser(input);
      if (error) throw new Error(error.message ?? "Unable to create user");
    },
    onSuccess: () => {
      setForm({ name: "", email: "", password: "", role: "user" });
      invalidate();
    },
  });

  const setRole = useMutation({
    mutationFn: async (input: { userId: string; role: "user" | "admin" }) => {
      const { error } = await authClient.admin.setRole(input);
      if (error) throw new Error(error.message ?? "Unable to update role");
    },
    onSuccess: invalidate,
  });

  const toggleBan = useMutation({
    mutationFn: async (input: { userId: string; banned: boolean }) => {
      const { error } = input.banned
        ? await authClient.admin.unbanUser({ userId: input.userId })
        : await authClient.admin.banUser({ userId: input.userId });
      if (error) throw new Error(error.message ?? "Unable to update access");
    },
    onSuccess: invalidate,
  });

  const removeUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await authClient.admin.removeUser({ userId });
      if (error) throw new Error(error.message ?? "Unable to delete user");
    },
    onSuccess: invalidate,
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createUser.mutate(form);
  }

  const mutationError =
    createUser.error ?? setRole.error ?? toggleBan.error ?? removeUser.error;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Users"
        description="Manage user accounts, roles, and access for this workspace."
      />

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
              Create user
            </CardTitle>
          </CardHeader>
          <form onSubmit={handleCreate} className="space-y-4 p-5">
            <Field id="user-name" label="Name">
              <Input
                id="user-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field id="user-email" label="Email">
              <Input
                id="user-email"
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field id="user-password" label="Password">
              <Input
                id="user-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field id="user-role" label="Role">
              <Select
                id="user-role"
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as "user" | "admin" })
                }
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </Select>
            </Field>
            <Button
              type="submit"
              disabled={createUser.isPending}
              size="lg"
              className="w-full"
            >
              {createUser.isPending && (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              )}
              Create user
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          {(error || mutationError) && (
            <Alert tone="danger" role="alert">
              {(error ?? mutationError)?.message}
            </Alert>
          )}

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>All users</CardTitle>
              {data && (
                <span className="rounded-full bg-muted-foreground/10 px-2.5 py-1 text-xs font-bold text-muted-foreground">
                  {data.total} accounts
                </span>
              )}
            </CardHeader>
            {isPending ? (
              <div className="flex justify-center p-8">
                <LoaderCircle
                  className="h-5 w-5 animate-spin text-muted-foreground"
                  aria-label="Loading"
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data?.users.map((u) => (
                  <li
                    key={u.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                        {u.name}
                        {u.role === "admin" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent">
                            <ShieldCheck className="h-3 w-3" aria-hidden />
                            admin
                          </span>
                        )}
                        {u.banned && (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">
                            banned
                          </span>
                        )}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {u.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setRole.mutate({
                            userId: u.id,
                            role: u.role === "admin" ? "user" : "admin",
                          })
                        }
                      >
                        {u.role === "admin" ? "Set as user" : "Set as admin"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          toggleBan.mutate({ userId: u.id, banned: !!u.banned })
                        }
                        aria-label={u.banned ? `Unban ${u.email}` : `Ban ${u.email}`}
                        className="h-9 w-9"
                      >
                        {u.banned ? (
                          <Undo2 className="h-4 w-4" aria-hidden />
                        ) : (
                          <Ban className="h-4 w-4" aria-hidden />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Delete user ${u.email}?`)) {
                            removeUser.mutate(u.id);
                          }
                        }}
                        aria-label={`Delete ${u.email}`}
                        className="h-9 w-9 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
