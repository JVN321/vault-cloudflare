import { cn } from "@/lib/utils";

type Tone = "success" | "destructive" | "warning" | "muted" | "primary";

const styles: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-warning/20 text-warning border-warning/40",
  muted: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/15 text-primary border-primary/30",
};

export function StatusPill({
  tone = "muted",
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, oklch(0.55 0.18 ${h}), oklch(0.42 0.16 ${(h + 40) % 360}))`,
      }}
    >
      {initials}
    </div>
  );
}
