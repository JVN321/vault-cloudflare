import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Lock, Unlock, ShieldAlert, ScanFace, Activity, Clock, Radio } from "lucide-react";
import { TopBar } from "@/components/vault/top-bar";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { settingsApi, authApi, commandsApi } from "@/lib/api";
import type { SystemConfig } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings · V.A.U.L.T" }] }),
  component: SettingsPage,
});

// ---------------------------------------------------------------------------
// Shared layout primitives
// ---------------------------------------------------------------------------
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ToggleRow({ icon: Icon, label, desc, checked, onChange, unavailable = false }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  unavailable?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${unavailable ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            {label}
            {unavailable && (
              <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Coming soon
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
      <Switch checked={checked && !unavailable} onCheckedChange={onChange} disabled={unavailable} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PIN manager sub-component
// ---------------------------------------------------------------------------
function PinManager() {
  const [show, setShow] = useState(false);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const length = 6;
  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, length);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (next.length !== length) return toast.error(`New PIN must be ${length} digits`);
    if (next !== confirm) return toast.error("PINs do not match");
    authApi
      .updatePin("", next)
      .then(() => { setNext(""); setConfirm(""); toast.success("PIN updated successfully"); })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to update PIN"));
  }

  return (
    <Section title="Master PIN Password" subtitle="Numeric fallback used at the keypad.">
      <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">New PIN</span>
          <Input
            type={show ? "text" : "password"}
            inputMode="numeric"
            value={next}
            onChange={(e) => setNext(onlyDigits(e.target.value))}
            placeholder="••••••"
            className="h-10 font-mono tracking-[0.4em]"
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
          />
        </label>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <button type="button" onClick={() => setShow((s) => !s)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {show ? "Hide PINs" : "Show PINs"}
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => { setNext(""); setConfirm(""); }}>Clear</Button>
            <Button type="submit">Update PIN</Button>
          </div>
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main settings page
// ---------------------------------------------------------------------------
function SettingsPage() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
  });

  const mutation = useMutation({
    mutationFn: (patch: Partial<SystemConfig>) => settingsApi.update(patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Settings updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const commandMutation = useMutation({
    mutationFn: (type: "LOCK" | "UNLOCK" | "PULSE") => commandsApi.send(type),
    onSuccess: () => toast.success("Command queued for device"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to queue command"),
  });

  const toggle = (key: keyof SystemConfig) => (v: boolean) => mutation.mutate({ [key]: v });

  if (isLoading) {
    return <div className="flex flex-1 items-center justify-center p-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <>
      <TopBar title="Settings" subtitle="Account, device, and network configuration" />
      <div className="grid gap-6 p-6 lg:grid-cols-2">

        {/* Hardware Controls */}
        <Section title="Hardware Controls" subtitle="Manual override for all entrances">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Button id="btn-lock" variant="outline" className="h-20 flex-col gap-1.5" onClick={() => commandMutation.mutate("LOCK")} disabled={commandMutation.isPending}>
              <Lock className="h-5 w-5 text-primary" /><span>Lock</span>
            </Button>
            <Button id="btn-unlock" variant="outline" className="h-20 flex-col gap-1.5" onClick={() => commandMutation.mutate("UNLOCK")} disabled={commandMutation.isPending}>
              <Unlock className="h-5 w-5 text-green-400" /><span>Unlock</span>
            </Button>
            <Button id="btn-lockdown" variant="destructive" className="h-20 flex-col gap-1.5" onClick={() => commandMutation.mutate("LOCK")} disabled={commandMutation.isPending}>
              <ShieldAlert className="h-5 w-5" /><span>Lockdown</span>
            </Button>
          </div>
        </Section>

        {/* Global Auth */}
        <Section title="Global Authentication" subtitle="Enable methods accepted facility-wide">
          <ToggleRow icon={ScanFace} label="Face Recognition" desc="Vision-based identity matching" checked={config?.allowFaceAuth ?? true} onChange={toggle("allowFaceAuth")} />
        </Section>

        {/* Security Settings */}
        <Section title="Security Settings">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Failed attempt limit</span>
                <Input id="failed-attempt-limit" type="number" defaultValue={config?.failedAttemptLimit ?? 3}
                  onBlur={(e) => mutation.mutate({ failedAttemptLimit: Number(e.target.value) })} className="h-10" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Auto-lock timer (sec)</span>
                <Input id="auto-lock-seconds" type="number" defaultValue={config?.autoLockSeconds ?? 30}
                  onBlur={(e) => mutation.mutate({ autoLockSeconds: Number(e.target.value) })} className="h-10" />
              </label>
            </div>
            <ToggleRow icon={Activity} label="Real-time Alerts" desc="Notify admins on denied attempts" checked={config?.realtimeAlerts ?? true} onChange={toggle("realtimeAlerts")} />
            <ToggleRow icon={Activity} label="Motion Detection" desc="Trigger camera recording on movement" checked={config?.motionDetection ?? false} onChange={toggle("motionDetection")} />
          </div>
        </Section>

        {/* Data Retention */}
        <Section title="Data Retention" subtitle="Control how long images are stored and how often the device checks in">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Image retention (days)
              </span>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  id="image-retention-days"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={config?.imageRetentionDays ?? 30}
                  onBlur={(e) => mutation.mutate({ imageRetentionDays: Number(e.target.value) })}
                  className="h-10"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Captured frames older than this are purged from R2 + D1 automatically.
              </p>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Device poll interval (ms)
              </span>
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  id="poll-interval-ms"
                  type="number"
                  min={500}
                  max={30000}
                  step={500}
                  defaultValue={config?.pollIntervalMs ?? 2000}
                  onBlur={(e) => mutation.mutate({ pollIntervalMs: Number(e.target.value) })}
                  className="h-10"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                How often the ESP32 polls for new commands (milliseconds).
              </p>
            </label>
          </div>
        </Section>

        {/* Network Settings */}
        <Section title="Network Settings" subtitle="Configure ESP32 Wi-Fi credentials">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">WiFi Network (SSID)</span>
              <Input defaultValue={config?.wifiSsid ?? ""} onBlur={(e) => mutation.mutate({ wifiSsid: e.target.value })} placeholder="Your network name" className="h-10" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">WiFi Password</span>
              <Input type="password" defaultValue={config?.wifiPassword ?? ""} onBlur={(e) => mutation.mutate({ wifiPassword: e.target.value })} placeholder="••••••••" className="h-10" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Device IP Address</span>
              <Input defaultValue={config?.deviceIp ?? "10.0.0.123"} onBlur={(e) => mutation.mutate({ deviceIp: e.target.value })} className="h-10 font-mono" />
            </label>
          </div>
        </Section>

        {/* Face Recognition Config */}
        <Section title="Face Recognition Config" subtitle="Manage Face++ integration keys">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Face++ API Key</span>
              <Input defaultValue={config?.faceplusplusApiKey ?? ""} onBlur={(e) => mutation.mutate({ faceplusplusApiKey: e.target.value })} placeholder="Leave blank to use .dev.vars" className="h-10" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Face++ API Secret</span>
              <Input type="password" defaultValue={config?.faceplusplusApiSecret ?? ""} onBlur={(e) => mutation.mutate({ faceplusplusApiSecret: e.target.value })} placeholder="••••••••" className="h-10" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Faceset ID</span>
              <Input defaultValue={config?.faceplusplusFaceset ?? "VAULT_FACESET"} onBlur={(e) => mutation.mutate({ faceplusplusFaceset: e.target.value })} className="h-10 font-mono" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Confidence Threshold</span>
              <Input type="number" defaultValue={config?.faceConfidenceThreshold ?? 60} onBlur={(e) => mutation.mutate({ faceConfidenceThreshold: Number(e.target.value) })} className="h-10" />
            </label>
          </div>
        </Section>

        {/* PIN Manager */}
        <PinManager />

      </div>
    </>
  );
}
