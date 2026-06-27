import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Shield, Eye, EyeOff, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign In · V.A.U.L.T" },
      {
        name: "description",
        content:
          "Vision-Based Access & Unified Locking Technology. Sign in to your secure admin console.",
      },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      await authApi.signIn(email, password);
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dark relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 text-foreground">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-primary) 1px, transparent 1px), linear-gradient(90deg, var(--color-primary) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 75%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--color-primary) 35%, transparent), transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_0_40px_-4px_var(--color-primary)]">
            <Shield className="h-7 w-7" strokeWidth={2.5} />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-[0.2em]">V.A.U.L.T</h1>
            <p className="mt-1 text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Vision-Based Access · Unified Locking
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/80 p-8 shadow-2xl backdrop-blur">
          <h2 className="text-lg font-semibold">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your secure admin console.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Email
              </label>
              <Input
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  className="h-11 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              id="sign-in-btn"
              type="submit"
              disabled={loading}
              className="group h-11 w-full font-semibold"
            >
              {loading ? "Signing in…" : "Sign In"}
              {!loading && (
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Protected by V.A.U.L.T biometric session encryption.
          </p>
        </div>
      </div>
    </div>
  );
}
