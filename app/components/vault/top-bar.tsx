import { Bell, Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { avatarInitials } from "@/lib/mock-data";

interface TopBarProps {
  title: string;
  subtitle?: string;
}

export function TopBar({ title, subtitle }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="hidden md:block">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users, logs, devices…"
            className="h-9 w-72 border-border bg-card pl-9 text-sm"
          />
        </div>
      </div>
      <button
        type="button"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive" />
      </button>
      <div className="flex items-center gap-3 rounded-full border border-border bg-card py-1 pl-1 pr-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {avatarInitials("Ava Chen")}
        </div>
        <div className="hidden text-xs leading-tight sm:block">
          <div className="font-medium">Ava Chen</div>
          <div className="text-muted-foreground">Security Admin</div>
        </div>
      </div>
    </header>
  );
}
