import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Copy, Send, Sparkles, Loader2, Trash2 } from "lucide-react";
import { TopBar } from "@/components/vault/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/vault/status-pill";
import { tempCodesApi } from "@/lib/api";
import type { TempCode } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/temporary-codes")({
  head: () => ({ meta: [{ title: "Temporary Codes · V.A.U.L.T" }] }),
  component: TempCodesPage,
});

function TempCodesPage() {
  const qc = useQueryClient();
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [location, setLocation] = useState("main");
  const [accessType, setAccessType] = useState("visitor");
  const [validFrom, setValidFrom] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");

  const { data: codes = [], isLoading } = useQuery({
    queryKey: ["temp-codes"],
    queryFn: () => tempCodesApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      tempCodesApi.create({
        location,
        accessType,
        validFrom: validFrom || new Date().toISOString(),
        expiresAt: expiresAt || new Date(Date.now() + 8 * 3600_000).toISOString(),
        notes: notes || undefined,
      }),
    onSuccess: (code: TempCode) => {
      setGenerated(code.code);
      setCopied(false);
      qc.invalidateQueries({ queryKey: ["temp-codes"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to generate"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => tempCodesApi.revoke(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["temp-codes"] });
      toast.success("Code revoked");
    },
  });

  function copy() {
    if (!generated) return;
    navigator.clipboard?.writeText(generated);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const locationLabels: Record<string, string> = {
    main: "Main Entrance",
    server: "Server Room",
    dock: "Loading Dock",
    side: "Side Door",
  };

  return (
    <>
      <TopBar title="Temporary Codes" subtitle="One-time and time-bound access credentials" />
      <div className="space-y-6 p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Create form */}
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3.5">
              <h2 className="font-semibold">Create New Code</h2>
              <p className="text-xs text-muted-foreground">Issue a time-limited credential for a visitor or contractor.</p>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Location</span>
                  <Select value={location} onValueChange={setLocation}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="main">Main Entrance</SelectItem>
                      <SelectItem value="server">Server Room</SelectItem>
                      <SelectItem value="dock">Loading Dock</SelectItem>
                      <SelectItem value="side">Side Door</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Access Type</span>
                  <Select value={accessType} onValueChange={setAccessType}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visitor">Visitor</SelectItem>
                      <SelectItem value="contractor">Contractor</SelectItem>
                      <SelectItem value="delivery">Delivery</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Valid From</span>
                  <Input type="datetime-local" className="h-10" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Expires</span>
                  <Input type="datetime-local" className="h-10" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </label>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Notes</span>
                <Textarea
                  placeholder="Optional: who's this for, purpose, etc."
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="h-11 w-full gap-2 font-semibold"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Generate Code
              </Button>
            </div>
          </section>

          {/* Preview */}
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3.5">
              <h2 className="font-semibold">Generated Code</h2>
              <p className="text-xs text-muted-foreground">Share securely with the recipient.</p>
            </div>
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8">
              {generated ? (
                <>
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                    <KeyRound className="h-7 w-7" />
                  </div>
                  <div className="text-center">
                    <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Access Code</div>
                    <div className="mt-2 select-all font-mono text-3xl font-bold tracking-[0.18em] text-primary">{generated}</div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      {locationLabels[location] ?? location} · {accessType}
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" onClick={copy} className="gap-2">
                      <Copy className="h-4 w-4" /> {copied ? "Copied!" : "Copy"}
                    </Button>
                    <Button className="gap-2"><Send className="h-4 w-4" /> Send</Button>
                  </div>
                </>
              ) : (
                <div className="text-center text-sm text-muted-foreground">
                  <KeyRound className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  Generate a code to preview it here.
                </div>
              )}
            </div>
          </section>
        </div>

        {/* History */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="font-semibold">Temporary Codes History</h2>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>Code</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Valid From</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.map((c: TempCode) => (
                  <TableRow key={c.id} className="border-border">
                    <TableCell className="font-mono text-sm font-medium">{c.code}</TableCell>
                    <TableCell className="text-sm">{c.location}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.accessType}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(c.validFrom).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(c.expiresAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <StatusPill
                        tone={c.status === "ACTIVE" ? "success" : c.status === "USED" ? "primary" : "muted"}
                      >
                        {c.status}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => deleteMutation.mutate(c.id)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Revoke code"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                {codes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No temporary codes yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
