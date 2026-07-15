"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataSelect } from "@/components/ui/data-select";
import { useConnections } from "@/app/settings/use-connections";

type Role = "admin" | "editor" | "viewer";
type Access = "read" | "write";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "admin", label: "admin" },
  { value: "editor", label: "editor" },
  { value: "viewer", label: "viewer" },
];

const ACCESS_OPTIONS: { value: Access | "none"; label: string }[] = [
  { value: "none", label: "no access" },
  { value: "read", label: "read" },
  { value: "write", label: "read + write" },
];

interface Grant {
  connectionId: string;
  access: Access;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  disabled: boolean;
  createdAt: string;
  grants: Grant[];
}

interface Connection {
  id: string;
  name: string;
}

async function apiJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

// ---------- sub-components ----------

function RoleBadge({ role }: { role: Role }) {
  const color = role === "admin" ? "var(--primary)" : role === "editor" ? "var(--success)" : "var(--muted-foreground)";
  return (
    <span
      className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: "var(--primary-soft)", color }}
    >
      {role}
    </span>
  );
}

function GrantsEditor({
  userId,
  grants,
  connections,
  onDone,
}: {
  userId: string;
  grants: Grant[];
  connections: Connection[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const setGrant = async (connectionId: string, access: Access | null) => {
    await apiJson(`/api/users/${userId}/grants`, {
      method: "POST",
      body: JSON.stringify({ connectionId, access }),
    });
    qc.invalidateQueries({ queryKey: ["users"] });
  };

  return (
    <div className="mt-2 space-y-1">
      {connections.map((c) => {
        const g = grants.find((g) => g.connectionId === c.id);
        return (
          <div key={c.id} className="flex items-center gap-2 text-[13px]">
            <span className="flex-1 truncate" style={{ color: "var(--muted-foreground)" }}>
              {c.name}
            </span>
            <DataSelect
              items={ACCESS_OPTIONS}
              value={ACCESS_OPTIONS.find((o) => o.value === (g?.access ?? "none")) ?? null}
              onChange={(o) => o && setGrant(c.id, o.value === "none" ? null : o.value)}
              getValue={(o) => o.value}
              getLabel={(o) => o.label}
              size="sm"
              className="w-auto"
            />
          </div>
        );
      })}
      <Button variant="secondary" size="sm" className="mt-1" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

function UserCard({
  user,
  currentUserId,
  connections,
}: {
  user: UserRow;
  currentUserId: string;
  connections: Connection[];
}) {
  const qc = useQueryClient();
  const [editingGrants, setEditingGrants] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patch = useMutation({
    mutationFn: (fields: Partial<{ role: Role; disabled: boolean; password: string }>) =>
      apiJson(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(fields),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const del = useMutation({
    mutationFn: () => apiJson(`/api/users/${user.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const isSelf = user.id === currentUserId;

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[14px]" style={{ color: "var(--foreground)" }}>
              {user.name || user.email}
            </span>
            {user.name && (
              <span className="text-[12px]" style={{ color: "var(--muted-foreground-faint)" }}>
                {user.email}
              </span>
            )}
            <RoleBadge role={user.role} />
            {user.disabled && (
              <span
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                style={{
                  background: "var(--destructive-soft)",
                  color: "var(--destructive)",
                }}
              >
                disabled
              </span>
            )}
            {isSelf && (
              <span className="text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
                (you)
              </span>
            )}
          </div>
          <p className="text-[11.5px] mt-0.5" style={{ color: "var(--muted-foreground-faint)" }}>
            {user.grants.length === 0
              ? user.role === "admin"
                ? "All connections (admin)"
                : "No connection grants"
              : `${user.grants.length} connection${user.grants.length !== 1 ? "s" : ""} granted`}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* role selector */}
          <DataSelect
            items={ROLE_OPTIONS}
            value={ROLE_OPTIONS.find((o) => o.value === user.role) ?? null}
            disabled={patch.isPending}
            onChange={(o) => o && patch.mutate({ role: o.value })}
            size="sm"
            className="w-auto"
          />

          {/* toggle disabled */}
          {!isSelf && (
            <Button
              variant="secondary"
              size="sm"

              title={user.disabled ? "Enable user" : "Disable user"}
              disabled={patch.isPending}
              onClick={() => patch.mutate({ disabled: !user.disabled })}
            >
              {user.disabled ? "enable" : "disable"}
            </Button>
          )}

          {/* delete */}
          {!isSelf &&
            (confirmDelete ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"

                  style={{ color: "var(--destructive)" }}
                  onClick={() => del.mutate()}
                >
                  confirm
                </Button>
                <Button
                  variant="secondary"
                  size="sm"

                  onClick={() => setConfirmDelete(false)}
                >
                  cancel
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"

                style={{ color: "var(--destructive)" }}
                onClick={() => setConfirmDelete(true)}
              >
                delete
              </Button>
            ))}
        </div>
      </div>

      {/* grants toggle (not for admins — they get all) */}
      {user.role !== "admin" && connections.length > 0 && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            className="text-[12px]"

            onClick={() => setEditingGrants((v) => !v)}
          >
            {editingGrants ? "Hide grants" : "Manage grants"}
          </Button>
          {editingGrants && (
            <GrantsEditor
              userId={user.id}
              grants={user.grants}
              connections={connections}
              onDone={() => setEditingGrants(false)}
            />
          )}
        </div>
      )}

      {patch.isError && (
        <p className="text-[12px]" style={{ color: "var(--destructive)" }}>
          {patch.error?.message}
        </p>
      )}
    </Card>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setEmail("");
    setName("");
    setPassword("");
    setRole("viewer");
    setError(null);
    setOpen(false);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiJson("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          name: name || undefined,
          password,
          role,
        }),
      });
      reset();
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ New user</Button>;
  }

  return (
    <Card className="p-4 space-y-3">
      <p className="font-medium text-[14px]" style={{ color: "var(--foreground)" }}>
        Create user
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Email *</label>
          <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Name (optional)</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Password * (min 8 chars)</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="label">Role</label>
          <DataSelect
            items={ROLE_OPTIONS}
            value={ROLE_OPTIONS.find((o) => o.value === role) ?? null}
            onChange={(o) => o && setRole(o.value)}
            className="w-full"
          />
        </div>
      </div>
      {error && (
        <p className="text-[12px]" style={{ color: "var(--destructive)" }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={busy || !email || password.length < 8} onClick={submit}>
          {busy ? "Creating…" : "Create"}
        </Button>
        <Button variant="secondary" onClick={reset}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// ---------- tab ----------

export function UsersTab() {
  const { user: self, isAdmin } = useAuth();
  const qc = useQueryClient();

  const { data: users, isLoading: usersLoading } = useQuery<UserRow[]>({
    queryKey: ["users"],
    queryFn: () => apiJson("/api/users"),
    enabled: isAdmin,
  });

  const { data: connections } = useConnections({ enabled: isAdmin });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Manage who can access Lizard and which databases they may read or write.
          </p>
        </div>
      </div>

      <CreateUserForm onCreated={() => qc.invalidateQueries({ queryKey: ["users"] })} />

      {usersLoading ? (
        <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </p>
      ) : (
        <div className="space-y-3">
          {(users ?? []).map((u) => (
            <UserCard key={u.id} user={u} currentUserId={self!.id} connections={connections ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}
