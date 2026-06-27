import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Eye, EyeOff, ShieldCheck, Loader2 } from "lucide-react";
import { TopBar } from "@/components/vault/top-bar";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { settingsApi, authApi } from "@/lib/api";
import type { SystemConfig } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings · V.A.U.L.T" }] }),
  component: SettingsPage,
});

function PinManager() {
  const [show, setShow] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pinEnabled, setPinEnabled] = useState(true);
  const [length, setLength] = useState<4 | 6>(6);

  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, length);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (current.length < 4) return toast.error("Enter your current PIN");
    if (next.length !== length) return toast.error(`New PIN must be ${length} digits`);
    if (next !== confirm) return toast.error("PINs do not match");
    if (/^(\d)\1+$/.test(next) || /0123|1234|2345|3456|4567|5678|6789/.test(next))
      return toast.error("Choose a less predictable PIN");
    authApi
      .updatePin(current, next)
      .then(() => {
        setCurrent(""); setNext(""); setConfirm("");
        toast.success("PIN updated successfully");
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to update PIN"));
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold">PIN Password</h2>
            <p className="text-xs text-muted-foreground">
              Numeric fallback used at the keypad when biometrics fail.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Enabled</span>
          <Switch checked={pinEnabled} onCheckedChange={setPinEnabled} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2 text-xs">
        <span className="text-muted-foreground">PIN length</span>
        {[4, 6].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setLength(n as 4 | 6)}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
              length === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {n} digits
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 text-success">
          <ShieldCheck className="h-3.5 w-3.5" /> Hashed at rest
        </span>
      </div>

      <form onSubmit={handleSave} className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Current PIN</span>
          <Input
            type={show ? "text" : "password"}
            inputMode="numeric"
            value={current}
            onChange={(e) => setCurrent(onlyDigits(e.target.value))}
            placeholder="••••••"
            className="h-10 font-mono tracking-[0.4em]"
            disabled={!pinEnabled}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">New PIN</span>
          <Input
            type={show ? "text" : "password"}
            inputMode="numeric"
            value={next}
            onChange={(e) => setNext(onlyDigits(e.target.value))}
            placeholder="••••••"
            className="h-10 font-mono tracking-[0.4em]"
            disabled={!pinEnabled}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Confirm New PIN</span>
          <Input
            type={show ? "text" : "password"}
            inputMode="numeric"
            value={confirm}
            onChange={(e) => setConfirm(onlyDigits(e.target.value))}
            placeholder="••••••"
            className="h-10 font-mono tracking-[0.4em]"
            disabled={!pinEnabled}
          />
        </label>

        <div className="flex items-center justify-between gap-3 sm:col-span-3">
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {show ? "Hide PINs" : "Show PINs"}
          </button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => { setCurrent(""); setNext(""); setConfirm(""); }}
            >
              Clear
            </Button>
            <Button type="submit" disabled={!pinEnabled}>Update PIN</Button>
          </div>
        </div>
      </form>
    </section>
  );
}

function NotificationsSection() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
  });

  const mutation = useMutation({
    mutationFn: (patch: Partial<SystemConfig>) => settingsApi.update(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold">Notifications</h2>
      <p className="text-xs text-muted-foreground">Choose what triggers a notification.</p>
      <div className="mt-4 space-y-3">
        {[
          { key: "realtimeAlerts" as const, label: "Failed access attempts" },
          { key: "motionDetection" as const, label: "Motion detection alerts" },
        ].map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between border-b border-border py-2 last:border-0">
            <span className="text-sm">{label}</span>
            <Switch
              checked={config?.[key] ?? false}
              onCheckedChange={(v) => mutation.mutate({ [key]: v })}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPage() {
  return (
    <>
      <TopBar title="Settings" subtitle="Account, organization, and preferences" />
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Profile</h2>
          <p className="text-xs text-muted-foreground">Update your admin profile.</p>
          <div className="mt-4 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Full Name</span>
              <Input defaultValue="Admin" className="h-10" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</span>
              <Input defaultValue="admin@vault.io" className="h-10" />
            </label>
            <Button>Save Profile</Button>
          </div>
        </section>

        <NotificationsSection />

        <PinManager />
      </div>
    </>
  );
}
