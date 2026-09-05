import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
  User,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Officer Sign In — SNARE" },
      {
        name: "description",
        content:
          "Sign in to the SNARE identity verification workbench to screen documents and review risk.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter your officer name or badge ID.");
      return;
    }
    if (!password) {
      setError("Please enter your password or security PIN.");
      return;
    }

    setLoading(true);
    // Frontend-only session: store the officer identity in localStorage.
    setTimeout(() => {
      signIn({ name: trimmed, email: `${trimmed.toLowerCase().replace(/\s+/g, ".")}@identra.gov.in` });
      navigate({ to: "/dashboard" });
    }, 500);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Minimal top bar */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 md:px-10 md:py-4">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary">
              <ShieldCheck className="size-5 text-primary-foreground" />
            </span>
            <span className="text-xl font-extrabold tracking-[0.12em] text-foreground">SNARE</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent"
          >
            <ArrowLeft className="size-3.5" />
            Back to Home
          </Link>
        </div>
      </header>

      <main
        className="flex flex-grow items-center justify-center px-4 py-12 md:py-16"
        style={{
          backgroundImage: "url(/skyline.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      >
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-border bg-card p-8 shadow-elevated">
            <div className="mb-6 text-center">
              <p className="label-caps mb-1 text-primary">
                राष्ट्रीय पहचान सत्यापन प्रणाली
              </p>
              <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in to continue to the SNARE workbench
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="login-name" className="label-caps mb-1 block">
                  Officer Name / Badge ID
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="login-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ramesh Sharma"
                    className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="label-caps mb-1 block">
                  Password / Security PIN
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-10 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="size-4 rounded border-border bg-background accent-primary"
                  />
                  <span>Remember Officer Session</span>
                </label>
                <button
                  type="button"
                  onClick={() => setError("Contact your administrator to reset your PIN.")}
                  className="font-semibold text-primary hover:underline"
                >
                  Forgot PIN?
                </button>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Enter Verification Workspace"
                )}
              </button>
            </form>

            <div className="mt-6 border-t border-border pt-5 text-center">
              <p className="text-sm text-muted-foreground">
                New verification officer?{" "}
                <Link to="/signup" className="font-bold text-primary hover:underline">
                  Register badge
                </Link>
              </p>
            </div>
          </div>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Authorized personnel only. All screening actions are audited and logged.
          </p>
        </div>
      </main>
    </div>
  );
}
