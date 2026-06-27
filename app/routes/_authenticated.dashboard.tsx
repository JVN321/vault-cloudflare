import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldAlert, Camera, Wifi, Unlock, BellOff, Lock, Users, DoorOpen,
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Play, Square, VideoOff, Thermometer, Droplets,
} from "lucide-react";
import { TopBar } from "@/components/vault/top-bar";
import { Avatar } from "@/components/vault/status-pill";
import { cn } from "@/lib/utils";
import { logsApi, sensorApi, imagesApi } from "@/lib/api";
import type { AccessLogEntry } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · V.A.U.L.T" }] }),
  component: Dashboard,
});

function Dashboard() {
  const now = new Date();
  const stamp = now.toLocaleTimeString([], { hour12: false });
  const dateStamp = now.toLocaleDateString([], {
    weekday: "short", year: "numeric", month: "short", day: "2-digit",
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["access-logs"],
    queryFn: () => logsApi.list(10),
    refetchInterval: 15_000,
  });

  const { data: sensor } = useQuery({
    queryKey: ["sensor-latest"],
    queryFn: () => sensorApi.latest(),
    refetchInterval: 10_000,
  });

  const successCount = logs.filter((l) => l.success).length;
  const failedCount = logs.filter((l) => !l.success).length;

  return (
    <div className="min-h-full bg-background text-foreground">
      <TopBar title="Dashboard" subtitle="Real-time access control overview" />
      <div className="space-y-4 p-4 md:p-6">
        {/* System status strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-success">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success pulse-dot" />
              <span className="font-mono-data text-[11px] font-semibold uppercase tracking-[0.2em]">
                SYS://OPERATIONAL
              </span>
            </div>
            <span className="hidden h-3.5 w-px bg-border sm:block" />
            <span className="hidden font-mono-data text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
              NODE_ID: CENTRAL-01 · UPLINK_OK
            </span>
            {sensor && (
              <>
                <span className="hidden h-3.5 w-px bg-border sm:block" />
                <span className="hidden items-center gap-3 font-mono-data text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:inline-flex">
                  {sensor.temperature != null && (
                    <span className="flex items-center gap-1">
                      <Thermometer className="h-3 w-3" /> {sensor.temperature.toFixed(1)}°C
                    </span>
                  )}
                  {sensor.humidity != null && (
                    <span className="flex items-center gap-1">
                      <Droplets className="h-3 w-3" /> {sensor.humidity.toFixed(0)}%
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
          <div className="font-mono-data text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <span className="text-foreground/60">{dateStamp}</span>
            <span className="ml-2 text-foreground/80">{stamp}</span>
            <span className="ml-2 text-foreground/40">UTC</span>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {/* Live camera */}
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm xl:col-span-2">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold tracking-tight">Live Camera Feed</h2>
                <span className="ml-2 font-mono-data text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  CAM-01 · MAIN_ENTRY
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 font-mono-data text-[10px] uppercase tracking-[0.2em] text-success">
                <Wifi className="h-3 w-3" /> Online
              </span>
            </div>
            <CameraStream stamp={stamp} />

            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-3 border-t border-border bg-muted/30 p-3 sm:grid-cols-4">
              <Kpi label="Lock Status" value="SECURED" tone="success" bar={1} icon={Lock} />
              <Kpi label="Active Users" value={String(logs.length)} tone="primary" bar={0.6} icon={Users} />
              <Kpi label="Today's Entries" value={String(successCount).padStart(3, "0")} tone="primary" bar={successCount / Math.max(logs.length, 1)} icon={DoorOpen} />
              <Kpi label="Security Alerts" value={String(failedCount).padStart(2, "0")} tone="warning" bar={failedCount / Math.max(logs.length, 1)} icon={AlertTriangle} />
            </div>
          </div>

          {/* Recent activity */}
          <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold tracking-tight">Recent Activity</h2>
              <span className="inline-flex items-center gap-1.5 font-mono-data text-[10px] uppercase tracking-[0.2em] text-success">
                <span className="h-1 w-1 rounded-full bg-success pulse-dot" />
                Auto-refresh
              </span>
            </div>
            <ul className="flex-1 divide-y divide-border overflow-y-auto">
              {logs.slice(0, 7).map((a: AccessLogEntry, i: number) => {
                const isDenied = !a.success;
                const isExit = a.action === "EXIT";
                const tone = isDenied ? "border-l-destructive" : isExit ? "border-l-primary" : "border-l-success";
                const Icon = isDenied ? AlertTriangle : isExit ? ArrowUpRight : ArrowDownLeft;
                const iconTone = isDenied ? "text-destructive" : isExit ? "text-primary" : "text-success";
                return (
                  <li
                    key={a.id}
                    className={cn("relative flex items-center gap-3 border-l-2 px-3.5 py-2.5", tone, i === 0 && "ticker-new")}
                  >
                    <Avatar name={a.userName ?? "?"} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium leading-tight">{a.userName ?? "Unknown"}</p>
                      <p className="truncate font-mono-data text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        {a.action ?? "Entry"} · {a.location ?? "Unknown"}
                      </p>
                    </div>
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", iconTone)} />
                    <span className="font-mono-data text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      {new Date(a.timestamp).toLocaleTimeString([], { hour12: false })}
                    </span>
                  </li>
                );
              })}
              {logs.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">No recent activity</li>
              )}
            </ul>
            <div className="border-t border-border px-4 py-2 text-right">
              <Link
                to="/access-logs"
                className="font-mono-data text-[10px] uppercase tracking-[0.25em] text-primary hover:underline"
              >
                View full log →
              </Link>
            </div>
          </div>
        </div>

        {/* Control rail */}
        <div className="grid gap-3 rounded-lg border border-border bg-card p-3 shadow-sm md:grid-cols-[1fr_1fr_2fr]">
          <ControlButton
            icon={<Unlock className="h-5 w-5 text-success" />}
            title="Unlock Main Entrance"
            sub="10s pulse"
          />
          <ControlButton
            icon={<BellOff className="h-5 w-5 text-primary" />}
            title="Reset Alarms"
            sub="Clear active alerts"
          />
          <LockdownButton />
        </div>
      </div>
    </div>
  );
}

function CameraStream({ stamp }: { stamp: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "live" | "error">("idle");
  const [error, setError] = useState<string>("");

  const { data: latestImage } = useQuery({
    queryKey: ["latest-image"],
    queryFn: () => imagesApi.latest(),
    refetchInterval: state === "live" ? false : 5_000,
  });

  async function start() {
    setState("loading");
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("live");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Camera unavailable");
      setState("error");
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("idle");
  }

  useEffect(() => () => stop(), []);

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-slate-950">
      <video
        ref={videoRef}
        playsInline
        muted
        className={cn("h-full w-full object-cover", state === "live" ? "opacity-100" : "opacity-0")}
      />

      {/* Show latest R2 image when not streaming */}
      {state !== "live" && latestImage && (
        <img
          src={imagesApi.getUrl(latestImage.objectKey)}
          alt="Latest camera capture"
          className="absolute inset-0 h-full w-full object-cover opacity-60"
        />
      )}

      {state !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-900/80 to-slate-950/90 text-slate-200">
          {state === "error" ? (
            <>
              <VideoOff className="h-10 w-10 text-destructive" />
              <div className="text-center">
                <p className="text-sm font-semibold">Camera unavailable</p>
                <p className="mt-1 max-w-xs px-4 font-mono-data text-[10px] uppercase tracking-[0.15em] text-slate-400">
                  {error}
                </p>
              </div>
              <button
                onClick={start}
                className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20"
              >
                <Play className="h-4 w-4" /> Retry
              </button>
            </>
          ) : (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/40">
                <Camera className="h-8 w-8" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">
                  {latestImage ? "Latest capture from ESP32" : "Camera feed offline"}
                </p>
                <p className="mt-1 font-mono-data text-[10px] uppercase tracking-[0.2em] text-slate-400">
                  {latestImage
                    ? `Captured ${new Date(latestImage.timestamp).toLocaleTimeString()}`
                    : "Tap to start streaming from connected camera"}
                </p>
              </div>
              <button
                onClick={start}
                disabled={state === "loading"}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:brightness-110 disabled:opacity-60"
              >
                <Play className="h-4 w-4" />
                {state === "loading" ? "Connecting…" : "Start Live Stream"}
              </button>
            </>
          )}
        </div>
      )}

      {state === "live" && (
        <>
          <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-destructive/40 bg-black/70 px-2 py-1 font-mono-data text-[10px] font-bold uppercase tracking-[0.25em] text-destructive backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive pulse-dot" /> LIVE
            </span>
            <button
              onClick={stop}
              className="inline-flex items-center gap-1.5 rounded-sm border border-white/20 bg-black/70 px-2 py-1 font-mono-data text-[10px] uppercase tracking-[0.2em] text-white backdrop-blur hover:bg-black/80"
            >
              <Square className="h-3 w-3 fill-current" /> Stop
            </button>
          </div>
          <div className="absolute inset-x-3 bottom-3 flex items-end justify-between font-mono-data text-[10px] uppercase tracking-[0.2em] text-white/80">
            <span className="rounded-sm border border-white/10 bg-black/70 px-2 py-1 backdrop-blur">
              CAM-01 · LIVE
            </span>
            <span className="rounded-sm border border-white/10 bg-black/70 px-2 py-1 backdrop-blur">
              TS {stamp}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  label, value, tone, bar, icon: Icon,
}: {
  label: string; value: string; tone: "primary" | "success" | "warning"; bar: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const valueTone = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-primary";
  const barTone = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-primary";
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono-data text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
        <Icon className={cn("h-3.5 w-3.5", valueTone)} />
      </div>
      <div className={cn("font-mono-data text-lg font-semibold leading-none", valueTone)}>{value}</div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", barTone)} style={{ width: `${Math.round(Math.min(bar, 1) * 100)}%` }} />
      </div>
    </div>
  );
}

function ControlButton({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <button className={cn(
      "group flex h-14 items-center gap-3 rounded-md border border-border bg-card px-4 text-left transition",
      "hover:-translate-y-px hover:border-primary/50 hover:shadow-md",
      "active:translate-y-0"
    )}>
      {icon}
      <div>
        <div className="text-sm font-medium leading-tight">{title}</div>
        <div className="font-mono-data text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{sub}</div>
      </div>
    </button>
  );
}

function LockdownButton() {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdingRef = useRef(false);

  function start() {
    setHolding(true);
    holdingRef.current = true;
    const startedAt = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - startedAt) / 1200);
      setProgress(p);
      if (p < 1 && holdingRef.current) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function stop() {
    holdingRef.current = false;
    setHolding(false);
    setProgress(0);
  }

  return (
    <button
      onMouseDown={start} onMouseUp={stop} onMouseLeave={stop}
      onTouchStart={start} onTouchEnd={stop}
      className={cn(
        "relative flex h-14 items-center justify-center gap-3 overflow-hidden rounded-md border font-bold uppercase tracking-[0.25em] transition",
        "border-destructive/60 bg-destructive/10 text-destructive",
        "hover:bg-destructive/15 hover:shadow-[0_0_24px_-6px_oklch(0.62_0.22_25/0.6)]"
      )}
    >
      <span
        className="absolute inset-y-0 left-0 bg-destructive/30 transition-[width] duration-75"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative inline-flex items-center gap-3">
        <span className="h-2 w-2 rounded-full bg-destructive pulse-dot" />
        <ShieldAlert className="h-5 w-5" />
        <span className="font-mono-data text-xs">
          {holding ? "Hold to confirm…" : "Emergency Lockdown"}
        </span>
      </span>
    </button>
  );
}
