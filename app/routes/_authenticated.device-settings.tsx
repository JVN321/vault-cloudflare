import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, Lock, Unlock, ShieldAlert, Wifi, ScanFace, QrCode, Activity, Loader2 } from "lucide-react";
import { TopBar } from "@/components/vault/top-bar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/vault/status-pill";
import { settingsApi } from "@/lib/api";
import type { SystemConfig } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/device-settings")({
  head: () => ({ meta: [{ title: "Device Settings · V.A.U.L.T" }] }),
  component: DeviceSettings,
});

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
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

function ToggleRow({
  icon: Icon,
  label,
  desc,
  checked,
  onChange,
  unavailable = false,
}: {
  icon: typeof ScanFace;
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  unavailable?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            unavailable ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
          }`}
        >
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
      <Switch
        checked={checked && !unavailable}
        onCheckedChange={onChange}
        disabled={unavailable}
      />
    </div>
  );
}

function DeviceSettings() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
  });

  const mutation = useMutation({
    mutationFn: (patch: Partial<SystemConfig>) => settingsApi.update(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const toggle = (key: keyof SystemConfig) => (v: boolean) =>
    mutation.mutate({ [key]: v });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <TopBar title="Device Settings" subtitle="Configure hardware, authentication, and network" />
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <Section title="Device Status">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Cpu className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-base font-semibold">VAULT-Edge-01</div>
                  <div className="text-xs text-muted-foreground">Firmware v3.4.1 · Last sync 2 min ago</div>
                </div>
                <StatusPill tone="success">Online</StatusPill>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="text-muted-foreground">CPU</div>
                  <div className="mt-0.5 text-sm font-semibold">12%</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="text-muted-foreground">Memory</div>
                  <div className="mt-0.5 text-sm font-semibold">428 MB</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="text-muted-foreground">Uptime</div>
                  <div className="mt-0.5 text-sm font-semibold">17d 4h</div>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Lock Controls" subtitle="Manual override for all entrances">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Button variant="outline" className="h-20 flex-col gap-1.5">
              <Lock className="h-5 w-5 text-primary" /><span>Lock</span>
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-1.5">
              <Unlock className="h-5 w-5 text-success" /><span>Unlock</span>
            </Button>
            <Button variant="destructive" className="h-20 flex-col gap-1.5">
              <ShieldAlert className="h-5 w-5" /><span>Lockdown</span>
            </Button>
          </div>
        </Section>

        <Section title="Global Authentication Controls" subtitle="Enable methods accepted facility-wide">
          <ToggleRow
            icon={ScanFace}
            label="Face Recognition"
            desc="Vision-based identity matching"
            checked={config?.allowFaceAuth ?? true}
            onChange={toggle("allowFaceAuth")}
          />
          <ToggleRow
            icon={QrCode}
            label="QR Code"
            desc="Mobile QR-based credentials"
            checked={config?.allowQrAuth ?? true}
            onChange={toggle("allowQrAuth")}
          />
        </Section>

        <Section title="Security Settings">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Failed attempt limit
                </span>
                <Input
                  type="number"
                  defaultValue={config?.failedAttemptLimit ?? 3}
                  onBlur={(e) => mutation.mutate({ failedAttemptLimit: Number(e.target.value) })}
                  className="h-10"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Auto-lock timer (sec)
                </span>
                <Input
                  type="number"
                  defaultValue={config?.autoLockSeconds ?? 30}
                  onBlur={(e) => mutation.mutate({ autoLockSeconds: Number(e.target.value) })}
                  className="h-10"
                />
              </label>
            </div>
            <ToggleRow
              icon={Activity}
              label="Real-time Alerts"
              desc="Notify admins on denied attempts"
              checked={config?.realtimeAlerts ?? true}
              onChange={toggle("realtimeAlerts")}
            />
            <ToggleRow
              icon={Activity}
              label="Motion Detection"
              desc="Trigger camera recording on movement"
              checked={config?.motionDetection ?? false}
              onChange={toggle("motionDetection")}
            />
          </div>
        </Section>

        <Section title="Network Settings">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">WiFi Network</span>
              <Input defaultValue="VAULT-SECURE" className="h-10" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">IP Address</span>
              <Input defaultValue="10.0.42.118" className="h-10 font-mono" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">MAC Address</span>
              <Input defaultValue="A4:2B:8E:11:7F:3D" className="h-10 font-mono" readOnly />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Connection Health</span>
              <div className="flex h-10 items-center justify-between rounded-md border border-input px-3">
                <span className="inline-flex items-center gap-1.5 text-sm text-success">
                  <Wifi className="h-4 w-4" /> Excellent
                </span>
                <span className="font-mono text-xs text-muted-foreground">-42 dBm</span>
              </div>
            </label>
          </div>
        </Section>
      </div>
    </>
  );
}
