import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AudioLines, LoaderCircle } from "lucide-react";
import { authClient } from "../lib/auth";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field, Input } from "../components/ui/Field";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message ?? "Unable to sign in");
      return;
    }
    navigate("/meetings", { replace: true });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <AudioLines className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">OpenMinutes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to manage meetings, recordings, and transcripts.
          </p>
        </div>

        <Card className="p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field id="email" label="Email">
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field id="password" label="Password">
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            )}
            <Button
              type="submit"
              disabled={loading}
              size="lg"
              className="w-full"
            >
              {loading && (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              )}
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          Accounts are managed by your administrator.
        </p>
      </div>
    </div>
  );
}
