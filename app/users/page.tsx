"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import { useRouter } from "next/navigation";

type Role = "admin" | "editor" | "viewer";
type Access = "read" | "write";

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
  const color =
    role === "admin"
      ? "var(--accent)"
      : role === "editor"
        ? "var(--green)"
        : "var(--text-dim)";
  return (
    <span
      className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: "var(--accent-soft)", color }}
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
            <span
              className="flex-1 truncate"
              style={{ color: "var(--text-dim)" }}
            >
              {c.name}
            </span>
            <select
              className="input"
              style={{ padding: "2px 6px", fontSize: 12, width: "auto" }}
              value={g?.access ?? ""}
              onChange={(e) =>
                setGrant(c.id, (e.target.value as Access) || null)
              }
            >
              <option value="">no access</option>
              <option value="read">read</option>
              <option value="write">read + write</option>
            </select>
          </div>
        );
      })}
      <button className="btn btn-sm mt-1" onClick={onDone}>
        Done
      </button>
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
    mutationFn: (
      fields: Partial<{ role: Role; disabled: boolean; password: string }>,
    ) =>
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
    <div className="panel p-4 space-y-2">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-medium text-[14px]"
              style={{ color: "var(--text)" }}
            >
              {user.name || user.email}
            </span>
            {user.name && (
              <span
                className="text-[12px]"
                style={{ color: "var(--text-faint)" }}
              >
                {user.email}
              </span>
            )}
            <RoleBadge role={user.role} />
            {user.disabled && (
              <span
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                style={{
                  background: "var(--red-soft, rgba(239,68,68,.12))",
                  color: "var(--red)",
                }}
              >
                disabled
              </span>
            )}
            {isSelf && (
              <span
                className="text-[11px]"
                style={{ color: "var(--text-faint)" }}
              >
                (you)
              </span>
            )}
          </div>
          <p
            className="text-[11.5px] mt-0.5"
            style={{ color: "var(--text-faint)" }}
          >
            {user.grants.length === 0
              ? user.role === "admin"
                ? "All connections (admin)"
                : "No connection grants"
              : `${user.grants.length} connection${user.grants.length !== 1 ? "s" : ""} granted`}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* role selector */}
          <select
            className="input"
            style={{ padding: "3px 6px", fontSize: 12, width: "auto" }}
            value={user.role}
            disabled={patch.isPending}
            onChange={(e) => patch.mutate({ role: e.target.value as Role })}
          >
            <option value="admin">admin</option>
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
          </select>

          {/* toggle disabled */}
          {!isSelf && (
            <button
              className="btn btn-sm"
              title={user.disabled ? "Enable user" : "Disable user"}
              disabled={patch.isPending}
              onClick={() => patch.mutate({ disabled: !user.disabled })}
            >
              {user.disabled ? "enable" : "disable"}
            </button>
          )}

          {/* delete */}
          {!isSelf &&
            (confirmDelete ? (
              <>
                <button
                  className="btn btn-sm"
                  style={{ color: "var(--red)" }}
                  onClick={() => del.mutate()}
                >
                  confirm
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  cancel
                </button>
              </>
            ) : (
              <button
                className="btn btn-sm"
                style={{ color: "var(--red)" }}
                onClick={() => setConfirmDelete(true)}
              >
                delete
              </button>
            ))}
        </div>
      </div>

      {/* grants toggle (not for admins — they get all) */}
      {user.role !== "admin" && connections.length > 0 && (
        <div>
          <button
            className="btn btn-sm text-[12px]"
            onClick={() => setEditingGrants((v) => !v)}
          >
            {editingGrants ? "Hide grants" : "Manage grants"}
          </button>
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
        <p className="text-[12px]" style={{ color: "var(--red)" }}>
          {patch.error?.message}
        </p>
      )}
    </div>
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
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + New user
      </button>
    );
  }

  return (
    <div className="panel p-4 space-y-3">
      <p className="font-medium text-[14px]" style={{ color: "var(--text)" }}>
        Create user
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Email *</label>
          <input
            className="input"
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Name (optional)</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Password * (min 8 chars)</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Role</label>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="admin">admin</option>
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
          </select>
        </div>
      </div>
      {error && (
        <p className="text-[12px]" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          disabled={busy || !email || password.length < 8}
          onClick={submit}
        >
          {busy ? "Creating…" : "Create"}
        </button>
        <button className="btn" onClick={reset}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- page ----------

export default function UsersPage() {
  const { user: self, isAdmin, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: users, isLoading: usersLoading } = useQuery<UserRow[]>({
    queryKey: ["users"],
    queryFn: () => apiJson("/api/users"),
    enabled: isAdmin,
  });

  const { data: connectionsData } = useQuery<{ data: Connection[] }>({
    queryKey: ["connections"],
    queryFn: () => apiJson("/api/connections"),
    enabled: isAdmin,
  });
  const connections: Connection[] = connectionsData?.data ?? [];

  // redirect non-admins
  if (!loading && !isAdmin) {
    router.replace("/");
    return null;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-semibold"
            style={{ color: "var(--text)" }}
          >
            Users
          </h1>
          <p
            className="text-[13px] mt-0.5"
            style={{ color: "var(--text-dim)" }}
          >
            Manage who can access Lizard and which databases they may read or
            write.
          </p>
        </div>
      </div>

      <CreateUserForm
        onCreated={() => qc.invalidateQueries({ queryKey: ["users"] })}
      />

      {usersLoading ? (
        <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
          Loading…
        </p>
      ) : (
        <div className="space-y-3">
          {(users ?? []).map((u) => (
            <UserCard
              key={u.id}
              user={u}
              currentUserId={self!.id}
              connections={connections}
            />
          ))}
        </div>
      )}
    </div>
  );
}
