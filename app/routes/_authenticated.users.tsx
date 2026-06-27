import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, MoreHorizontal, Trash2, Save, Loader2 } from "lucide-react";
import { TopBar } from "@/components/vault/top-bar";
import { StatusPill, Avatar } from "@/components/vault/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usersApi } from "@/lib/api";
import type { VaultUser, AuthMethod } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users · V.A.U.L.T" }] }),
  component: UsersPage,
});

const methodLabels: Record<string, string> = {
  QR: "QR",
  FACE: "Face",
  PIN: "PIN",
  BARCODE: "Barcode",
  RFID: "RFID",
};

function UsersPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<VaultUser | null>(null);
  const [query, setQuery] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<VaultUser> }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User updated");
      setSelected(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User removed");
      setSelected(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const accessMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { allowedAuthMethods?: AuthMethod[] };
    }) => usersApi.updateAccess(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("Access updated");
    },
  });

  const filtered = users.filter((u) =>
    (u.name + u.email + (u.department ?? ""))
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  return (
    <>
      <TopBar title="User Management" subtitle={`${users.length} registered users`} />
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users…"
              className="h-10 pl-9"
            />
          </div>
          <Select defaultValue="all">
            <SelectTrigger className="h-10 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="ADMIN">Admin</SelectItem>
              <SelectItem value="MANAGER">Manager</SelectItem>
              <SelectItem value="EMPLOYEE">Employee</SelectItem>
              <SelectItem value="VISITOR">Visitor</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all">
            <SelectTrigger className="h-10 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
              <SelectItem value="SUSPENDED">Suspended</SelectItem>
            </SelectContent>
          </Select>
          <Button className="h-10 gap-2">
            <Plus className="h-4 w-4" /> Add User
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
                  <TableHead className="w-10"><Checkbox /></TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-center">QR</TableHead>
                  <TableHead className="text-center">Face</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const hasQr = u.allowedAuthMethods.includes("QR");
                  const hasFace = u.allowedAuthMethods.includes("FACE");
                  return (
                    <TableRow
                      key={u.id}
                      onClick={() => setSelected(u)}
                      className="cursor-pointer border-border"
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} size={34} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{u.name}</div>
                            <div className="text-xs text-muted-foreground">{u.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><span className="text-sm">{u.role}</span></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.department ?? "—"}</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-block h-2 w-2 rounded-full ${hasQr ? "bg-success" : "bg-muted-foreground/30"}`} />
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-block h-2 w-2 rounded-full ${hasFace ? "bg-success" : "bg-muted-foreground/30"}`} />
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          tone={
                            u.status === "ACTIVE"
                              ? "success"
                              : u.status === "SUSPENDED"
                              ? "destructive"
                              : "muted"
                          }
                        >
                          {u.status}
                        </StatusPill>
                      </TableCell>
                      <TableCell>
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>User Details</SheetTitle>
              </SheetHeader>
              <div className="space-y-6 p-4">
                <div className="flex items-center gap-4">
                  <Avatar name={selected.name} size={64} />
                  <div>
                    <div className="text-lg font-semibold">{selected.name}</div>
                    <div className="text-sm text-muted-foreground">{selected.email}</div>
                    <div className="mt-1 flex gap-2">
                      <StatusPill tone="primary" dot={false}>{selected.role}</StatusPill>
                      {selected.department && (
                        <StatusPill tone="muted" dot={false}>{selected.department}</StatusPill>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Access Permissions
                  </h3>
                  <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
                    {(["QR", "FACE"] as AuthMethod[]).map((m) => (
                      <div key={m} className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">{methodLabels[m]} Authentication</div>
                          <div className="text-xs text-muted-foreground">Allow {methodLabels[m]} access</div>
                        </div>
                        <Switch
                          defaultChecked={selected.allowedAuthMethods.includes(m)}
                          onCheckedChange={(v) => {
                            const current = selected.allowedAuthMethods;
                            const updated = v
                              ? [...current, m]
                              : current.filter((x) => x !== m);
                            accessMutation.mutate({
                              id: selected.id,
                              data: { allowedAuthMethods: updated },
                            });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Created <span className="text-foreground">{new Date(selected.createdAt).toLocaleDateString()}</span>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    className="flex-1 gap-2"
                    onClick={() => updateMutation.mutate({ id: selected.id, data: {} })}
                  >
                    <Save className="h-4 w-4" /> Save Changes
                  </Button>
                  <Button
                    variant="destructive"
                    className="gap-2"
                    onClick={() => deleteMutation.mutate(selected.id)}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
