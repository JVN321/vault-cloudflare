import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/vault/top-bar";
import { Button } from "@/components/ui/button";
import { logsApi } from "@/lib/api";
import { StatusPill, Avatar } from "@/components/vault/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import type { AccessLogEntry } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/access-logs")({
  head: () => ({ meta: [{ title: "Access Logs · V.A.U.L.T" }] }),
  component: AccessLogsPage,
});

function AccessLogsPage() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["access-logs"],
    queryFn: () => logsApi.list(200),
    refetchInterval: 30_000,
  });

  return (
    <>
      <TopBar title="Access Logs" subtitle="Complete audit trail of all access events" />
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{logs.length} total events</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/analytics">Open in Analytics</Link>
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>User</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l: AccessLogEntry) => (
                  <TableRow key={l.id} className="border-border">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={l.userName ?? "?"} size={28} />
                        <span className="text-sm">{l.userName ?? "Unknown"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.method}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.location ?? "—"}</TableCell>
                    <TableCell className="text-sm">{l.action ?? "ENTRY"}</TableCell>
                    <TableCell>
                      <StatusPill tone={l.success ? "success" : "destructive"}>
                        {l.success ? "Granted" : "Denied"}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(l.timestamp).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
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
