import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download, Trash2, ImageIcon, AlertTriangle, Filter,
  RefreshCw, Clock, HardDrive, Zap,
} from "lucide-react";
import { TopBar } from "@/components/vault/top-bar";
import { imagesApi } from "@/lib/api";
import type { ImageMeta } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/images")({
  head: () => ({ meta: [{ title: "Images · V.A.U.L.T" }] }),
  component: ImagesPage,
});

type Filter = "all" | "motion";

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function ImagesPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const queryClient = useQueryClient();

  const { data: images = [], isLoading, refetch } = useQuery({
    queryKey: ["images", filter],
    queryFn: () => imagesApi.list(200, filter === "motion"),
    refetchInterval: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => imagesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["images"] });
      toast.success("Image deleted");
    },
    onError: () => toast.error("Failed to delete image"),
  });

  const cleanupMutation = useMutation({
    mutationFn: () => imagesApi.cleanup(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["images"] });
      toast.success(`Cleanup complete — ${data.deleted} image${data.deleted !== 1 ? "s" : ""} removed`);
    },
    onError: () => toast.error("Cleanup failed"),
  });

  const motionCount = images.filter((i) => i.motionDetected).length;

  return (
    <div className="min-h-full bg-background text-foreground">
      <TopBar title="Images" subtitle="Camera captures stored in R2" />

      <div className="space-y-4 p-4 md:p-6">
        {/* Stats strip */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <StatChip icon={ImageIcon} label="Total" value={String(images.length)} />
          <span className="h-3.5 w-px bg-border" />
          <StatChip icon={Zap} label="Motion" value={String(motionCount)} tone="warning" />
          <span className="h-3.5 w-px bg-border" />
          <StatChip
            icon={HardDrive}
            label="Storage"
            value={formatBytes(images.reduce((s, i) => s + (i.fileSize ?? 0), 0))}
          />
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
            <button
              id="cleanup-btn"
              onClick={() => cleanupMutation.mutate()}
              disabled={cleanupMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
            >
              <Clock className="h-3 w-3" />
              {cleanupMutation.isPending ? "Cleaning…" : "Run Cleanup"}
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit">
          {(["all", "motion"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all",
                filter === f
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? "All Images" : "Motion Only"}
            </button>
          ))}
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-video animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-20 text-center">
            <ImageIcon className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No images yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Images appear here when the ESP32 uploads captures
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {images.map((img) => (
              <ImageCard
                key={img.id}
                img={img}
                onDelete={() => deleteMutation.mutate(img.id)}
                deleting={deleteMutation.isPending && deleteMutation.variables === img.id}
              />
            ))}
          </div>
        )}

        {/* Retention notice */}
        <p className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50">
          Images auto-deleted after 30 days · Configurable in Settings
        </p>
      </div>
    </div>
  );
}

function StatChip({
  icon: Icon, label, value, tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("h-3 w-3", tone === "warning" ? "text-warning" : "text-muted-foreground")} />
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-[11px] font-semibold", tone === "warning" ? "text-warning" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function ImageCard({
  img, onDelete, deleting,
}: {
  img: ImageMeta;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const imgUrl = imagesApi.getUrl(img.objectKey);
  const dlUrl = imagesApi.getDownloadUrl(img.objectKey);

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden bg-slate-950">
        {!errored ? (
          <>
            {!loaded && (
              <div className="absolute inset-0 animate-pulse bg-muted" />
            )}
            <img
              src={imgUrl}
              alt={`Capture ${img.id}`}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setErrored(true)}
              className={cn(
                "h-full w-full object-cover transition-opacity duration-300",
                loaded ? "opacity-100" : "opacity-0"
              )}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/40" />
          </div>
        )}

        {/* Motion badge */}
        {img.motionDetected && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-sm border border-warning/40 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-warning backdrop-blur">
            <span className="h-1 w-1 rounded-full bg-warning" />
            Motion
          </span>
        )}

        {/* Hover action overlay */}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
          <a
            href={dlUrl}
            id={`download-img-${img.id}`}
            download
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow hover:brightness-110 transition"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            id={`delete-img-${img.id}`}
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-destructive text-white shadow hover:brightness-110 transition disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Metadata footer */}
      <div className="px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {new Date(img.timestamp).toLocaleString([], {
            month: "short", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
          })}
        </p>
        <div className="mt-0.5 flex items-center justify-between">
          <span className="font-mono text-[9px] text-muted-foreground/60">
            CAM-{img.cameraId ?? "?"}
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/60">
            {formatBytes(img.fileSize)}
          </span>
        </div>
      </div>
    </div>
  );
}
