import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
  icon: LucideIcon;
  accent?: "primary" | "success" | "destructive" | "warning";
}

const accentMap = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/15 text-destructive",
  warning: "bg-warning/15 text-warning",
} as const;

export function StatCard({ label, value, delta, deltaTone = "neutral", icon: Icon, accent = "primary" }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 transition hover:border-primary/40 hover:shadow-[0_0_0_1px_var(--color-primary)]/20">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          {delta && (
            <p
              className={cn(
                "mt-1 text-xs font-medium",
                deltaTone === "up" && "text-success",
                deltaTone === "down" && "text-destructive",
                deltaTone === "neutral" && "text-muted-foreground",
              )}
            >
              {delta}
            </p>
          )}
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", accentMap[accent])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
