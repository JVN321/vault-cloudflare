import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, DoorOpen, ShieldCheck, AlertTriangle, ScanFace, QrCode, Calendar, Loader2,
} from "lucide-react";
import { TopBar } from "@/components/vault/top-bar";
import { StatCard } from "@/components/vault/stat-card";
import { StatusPill, Avatar } from "@/components/vault/status-pill";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { logsApi } from "@/lib/api";
import type { AccessLogEntry } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics · V.A.U.L.T" }] }),
  component: Analytics,
});

const methodIcon: Record<string, typeof ScanFace> = {
  FACE: ScanFace,
  QR: QrCode,
  face: ScanFace,
  qr: QrCode,
};

function Analytics() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["access-logs"],
    queryFn: () => logsApi.list(200),
    refetchInterval: 30_000,
  });

  const totalEntries = logs.filter((l) => l.success).length;
  const failedAttempts = logs.filter((l) => !l.success).length;
  const successRate =
    logs.length > 0 ? ((totalEntries / logs.length) * 100).toFixed(1) + "%" : "—";

  return (
    <>
      <TopBar title="Analytics" subtitle="Access patterns & system intelligence" />
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Entries (7d)" value={totalEntries} delta="+18% week over week" deltaTone="up" icon={DoorOpen} accent="primary" />
          <StatCard label="Successful Auth" value={successRate} delta="+0.6% this week" deltaTone="up" icon={ShieldCheck} accent="success" />
          <StatCard label="Failed Attempts" value={failedAttempts} delta="-2 vs last week" deltaTone="up" icon={AlertTriangle} accent="warning" />
          <StatCard label="Avg Auth Time" value="0.8s" delta="Face recognition" deltaTone="neutral" icon={Activity} accent="primary" />
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <Button variant="outline" className="h-9 gap-2"><Calendar className="h-4 w-4" /> Last 7 days</Button>
          <Select defaultValue="all">
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              <SelectItem value="main">Main Entrance</SelectItem>
              <SelectItem value="server">Server Room</SelectItem>
              <SelectItem value="dock">Loading Dock</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all">
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="FACE">Face</SelectItem>
              <SelectItem value="QR">QR</SelectItem>
              <SelectItem value="PIN">PIN</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all">
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="granted">Granted</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto text-xs text-muted-foreground">{logs.length} events</div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="font-semibold">Access Activity Logs</h2>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>User</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l: AccessLogEntry) => {
                  const Icon = methodIcon[l.method] ?? Activity;
                  const status = l.success ? "granted" : "denied";
                  return (
                    <TableRow key={l.id} className="border-border">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar name={l.userName ?? "?"} size={32} />
                          <span className="text-sm font-medium">{l.userName ?? "Unknown"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(l.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="text-sm">{l.location ?? "—"}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Icon className="h-4 w-4 text-primary" />
                          <span className="capitalize text-muted-foreground">{l.method.toLowerCase()}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={status === "granted" ? "success" : "destructive"}>
                          {l.action ?? "Entry"} · {status}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(l.timestamp).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No access logs yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
