import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Copy, Send, Sparkles, Loader2, Trash2 } from "lucide-react";
import { TopBar } from "@/components/vault/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/vault/status-pill";
import { tempPinsApi } from "@/lib/api";
import type { TempPin } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/temporary-codes")({
  head: () => ({ meta: [{ title: "Temporary PINs · V.A.U.L.T" }] }),
  component: TempCodesPage,
});

function TempCodesPage() {
  const qc = useQueryClient();
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");

  const { data: pins = [], isLoading } = useQuery({
    queryKey: ["temp-pins"],
    queryFn: () => tempPinsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      // Generate a random 6-digit PIN
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      return tempPinsApi.create({
        pin,
        label: label || undefined,
        maxUses: maxUses ? parseInt(maxUses, 10) : 1,
        expiresAt: expiresAt || new Date(Date.now() + 8 * 3600_000).toISOString(),
      }).then(res => ({ ...res, pin })); // pass back the unhashed pin for display
    },
    onSuccess: (code) => {
      setGenerated(code.pin);
      setCopied(false);
      qc.invalidateQueries({ queryKey: ["temp-pins"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to generate"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => tempPinsApi.revoke(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["temp-pins"] });
      toast.success("PIN revoked and deleted");
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => tempPinsApi.revokeAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["temp-pins"] });
      toast.success("All PINs revoked and deleted");
    },
  });

  function copy() {
    if (!generated) return;
    navigator.clipboard?.writeText(generated);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <TopBar title="Temporary PINs" subtitle="One-time and time-bound access credentials" />
      <div className="space-y-6 p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Create form */}
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3.5">
              <h2 className="font-semibold">Create New PIN</h2>
              <p className="text-xs text-muted-foreground">Issue a time-limited or limited-use PIN for a visitor.</p>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Label / Name</span>
                  <Input placeholder="e.g. Plumber, Guest" className="h-10" value={label} onChange={(e) => setLabel(e.target.value)} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Max Uses</span>
                  <Input type="number" min={1} className="h-10" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Expires</span>
                  <Input type="datetime-local" className="h-10" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </label>
              </div>
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
                Generate PIN
              </Button>
            </div>
          </section>

          {/* Preview */}
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3.5">
              <h2 className="font-semibold">Generated PIN</h2>
              <p className="text-xs text-muted-foreground">Share securely with the recipient. This PIN is not saved in plain text.</p>
            </div>
            <div className="flex min-h-[250px] flex-col items-center justify-center gap-4 p-8">
              {generated ? (
                <>
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                    <KeyRound className="h-7 w-7" />
                  </div>
                  <div className="text-center">
                    <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Access PIN</div>
                    <div className="mt-2 select-all font-mono text-4xl font-bold tracking-[0.18em] text-primary">{generated}</div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      {label || "Temporary PIN"}
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" onClick={copy} className="gap-2">
                      <Copy className="h-4 w-4" /> {copied ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center text-sm text-muted-foreground">
                  <KeyRound className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  Generate a PIN to preview it here.
                </div>
              )}
            </div>
          </section>
        </div>

        {/* History */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="font-semibold">Temporary PINs History</h2>
            {pins.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  if (confirm("Are you sure you want to revoke and delete all temporary PINs?")) {
                    deleteAllMutation.mutate();
                  }
                }}
                disabled={deleteAllMutation.isPending}
              >
                {deleteAllMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Trash2 className="mr-2 h-3 w-3" />}
                Revoke All
              </Button>
            )}
          </div>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>Label</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pins.map((c: TempPin) => (
                  <TableRow key={c.id} className="border-border">
                    <TableCell className="font-medium">{c.label || "—"}</TableCell>
                    <TableCell className="font-mono text-primary font-bold tracking-widest">{c.pin || "••••••"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(c.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(c.expiresAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.useCount} / {c.maxUses}
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
                        title="Revoke PIN"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                {pins.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No temporary PINs yet.
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

