import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Cpu,
  BarChart3,
  ScrollText,
  KeyRound,
  Settings,
  Shield,
  LogOut,
  ChevronsLeft,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/users", label: "Users", icon: Users },
  { to: "/device-settings", label: "Device Settings", icon: Cpu },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/access-logs", label: "Access Logs", icon: ScrollText },
  { to: "/temporary-codes", label: "Temporary Codes", icon: KeyRound },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();

  function signOut() {
    navigate({ to: "/", replace: true });
  }

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-1 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_24px_-4px_var(--color-primary)]">
            <Shield className="h-5 w-5" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-bold tracking-[0.18em] text-sidebar-foreground">V.A.U.L.T</span>
              <span className="truncate text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
                Access Control
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const active = pathname === item.to || pathname.startsWith(item.to + "/");
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        "h-10 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[active=true]:bg-primary/15 data-[active=true]:text-primary data-[active=true]:font-medium",
                      )}
                    >
                      <Link to={item.to}>
                        <item.icon className="h-4.5 w-4.5" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut} className="text-sidebar-foreground/70 hover:text-destructive">
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleSidebar} className="text-sidebar-foreground/50">
              <ChevronsLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
              <span>Collapse</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
