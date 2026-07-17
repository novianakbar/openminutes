import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  AudioLines,
  BadgeCheck,
  Eye,
  EyeOff,
  LockKeyhole,
  LoaderCircle,
  Mail,
  Mic2,
  ShieldCheck,
} from "lucide-react";
import { authClient } from "../lib/auth";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field, Input } from "../components/ui/Field";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const session = authClient.useSession();

  function handlePasswordKey(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLockOn(event.getModifierState("CapsLock"));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await authClient.signIn.email(
        { email, password, rememberMe },
        { disableSignal: true },
      );
      if (error) {
        setError(error.message ?? "Unable to sign in");
        return;
      }
      await session.refetch({ query: { disableCookieCache: true } });
      navigate("/meetings", { replace: true });
    } catch {
      setError("Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(45,212,191,0.24),transparent_30%),radial-gradient(circle_at_82%_12%,rgba(37,99,235,0.16),transparent_28%),linear-gradient(135deg,rgba(246,251,251,1)_0%,rgba(238,247,246,0.92)_48%,rgba(255,255,255,1)_100%)] dark:bg-[radial-gradient(circle_at_18%_16%,rgba(45,212,191,0.16),transparent_30%),radial-gradient(circle_at_82%_12%,rgba(96,165,250,0.14),transparent_28%),linear-gradient(135deg,rgba(7,19,18,1)_0%,rgba(13,31,29,1)_54%,rgba(6,13,12,1)_100%)]"
        aria-hidden
      />

      <main className="relative mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <section className="hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur">
            <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
            Self-hosted meeting intelligence
          </div>
          <h1 className="mt-6 max-w-xl text-5xl font-bold leading-[1.05] tracking-tight">
            OpenMinutes turns meeting records into a searchable team workspace.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            Review recordings, live transcripts, summaries, and settings without
            digging through scattered notes.
          </p>

          <div className="mt-10 grid max-w-xl gap-3">
            {[
              {
                icon: Mic2,
                title: "Capture the room",
                copy: "Record meetings and keep transcript context close to the source.",
              },
              {
                icon: BadgeCheck,
                title: "Move faster after calls",
                copy: "Turn long conversations into useful summaries and next steps.",
              },
              {
                icon: LockKeyhole,
                title: "Manage access",
                copy: "Keep users, API keys, and bot settings organized in one place.",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="grid grid-cols-[2.75rem_1fr] gap-4 rounded-lg border border-border bg-surface/72 p-4 shadow-sm backdrop-blur"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold tracking-tight">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {item.copy}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mx-auto w-full max-w-lg">
          <div className="mb-6 text-center lg:text-left">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-lg shadow-accent/20 lg:mx-0">
              <AudioLines className="h-6 w-6" aria-hidden />
            </div>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-accent">
              OpenMinutes
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              Welcome back
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Sign in to continue where your meetings left off.
            </p>
          </div>

          <Card className="rounded-lg border-border/80 bg-surface/92 p-6 shadow-2xl shadow-foreground/5 backdrop-blur sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <Field
                id="email"
                label="Email address"
                hint="Enter the email connected to your workspace."
              >
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 bg-surface pl-11 text-[15px]"
                  />
                </div>
              </Field>
              <Field
                id="password"
                label="Password"
                hint={
                  capsLockOn
                    ? "Caps Lock is on. Passwords are case-sensitive."
                    : "Password is case-sensitive."
                }
              >
                <div className="relative">
                  <LockKeyhole
                    className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handlePasswordKey}
                    onKeyUp={handlePasswordKey}
                    onBlur={() => setCapsLockOn(false)}
                    className="h-12 bg-surface px-11 text-[15px]"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" aria-hidden />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden />
                    )}
                  </button>
                </div>
              </Field>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background/70 px-3.5 py-3 text-sm transition-colors duration-200 hover:bg-surface-hover">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
                <span>
                  <span className="block font-semibold text-foreground">
                    Keep me signed in
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    Turn this off on shared or public devices.
                  </span>
                </span>
              </label>

              {error && (
                <Alert tone="danger" role="alert">
                  {error}
                </Alert>
              )}
              <Button
                type="submit"
                disabled={loading}
                size="lg"
                className="h-12 w-full text-[15px] shadow-lg shadow-accent/20"
              >
                {loading && (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                )}
                {loading ? "Signing in..." : "Sign in"}
              </Button>

              <p className="text-center text-xs leading-5 text-muted-foreground">
                Password trouble? Ask your workspace owner to reset it.
              </p>
            </form>
          </Card>

          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground lg:text-left">
            New here? Request an invite before trying to sign in.
          </p>
        </section>
      </main>
    </div>
  );
}
