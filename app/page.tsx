"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface ConnectionRow {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  readUser: string;
  writeUser: string | null;
  hasWrite: boolean;
  ssl: boolean;
  allowedSchemas: string[] | null;
  status: { read: string | null; write: string | null };
}

const EMPTY_FORM = {
  name: "",
  host: "localhost",
  port: "5432",
  database: "",
  readUser: "",
  readPassword: "",
  writeUser: "",
  writePassword: "",
  ssl: false,
};

export default function ConnectionsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const { data: connections, isLoading } = useQuery<ConnectionRow[]>({
    queryKey: ["connections"],
    queryFn: async () => (await fetch("/api/connections")).json(),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          port: Number(form.port),
          writeUser: form.writeUser || null,
          writePassword: form.writePassword || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to add connection");
      return body;
    },
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setShowForm(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/connections/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold">Connections</h1>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Add connection"}
        </button>
      </div>
      <p className="text-[13px] mb-6" style={{ color: "var(--text-dim)" }}>
        Register each microservice&apos;s Postgres database. Lizard introspects every schema and makes the
        whole fleet browsable, editable, and queryable — including cross-database questions and charts.
      </p>

      {showForm && (
        <div className="panel p-5 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Name (identifier, e.g. users_service)</label>
              <input className="input" value={form.name} onChange={set("name")} placeholder="users_service" />
            </div>
            <div>
              <label className="label">Database</label>
              <input className="input" value={form.database} onChange={set("database")} placeholder="users_service" />
            </div>
            <div>
              <label className="label">Host</label>
              <input className="input" value={form.host} onChange={set("host")} />
            </div>
            <div>
              <label className="label">Port</label>
              <input className="input" value={form.port} onChange={set("port")} />
            </div>
            <div>
              <label className="label">Read user (SELECT-only role)</label>
              <input className="input" value={form.readUser} onChange={set("readUser")} placeholder="lizard_read" />
            </div>
            <div>
              <label className="label">Read password</label>
              <input className="input" type="password" value={form.readPassword} onChange={set("readPassword")} />
            </div>
            <div>
              <label className="label">Write user (optional — enables CRUD)</label>
              <input className="input" value={form.writeUser} onChange={set("writeUser")} placeholder="lizard_write" />
            </div>
            <div>
              <label className="label">Write password</label>
              <input className="input" type="password" value={form.writePassword} onChange={set("writePassword")} />
            </div>
          </div>
          <label className="flex items-center gap-2 mt-4 text-[13px]" style={{ color: "var(--text-dim)" }}>
            <input type="checkbox" checked={form.ssl} onChange={set("ssl")} /> Use SSL
          </label>
          {error && (
            <p className="mt-3 text-[13px]" style={{ color: "var(--red)" }}>
              {error}
            </p>
          )}
          <div className="mt-4">
            <button className="btn btn-primary" disabled={addMutation.isPending} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "Testing & saving…" : "Save connection"}
            </button>
          </div>
        </div>
      )}

      {isLoading && <p style={{ color: "var(--text-dim)" }}>Loading…</p>}

      <div className="space-y-3">
        {connections?.map((c) => (
          <div key={c.id} className="panel px-5 py-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[14px]">{c.name}</span>
                {c.status.read === null ? (
                  <span className="tag" style={{ color: "var(--green)" }}>read ok</span>
                ) : (
                  <span className="tag" style={{ color: "var(--red)" }} title={c.status.read}>read failed</span>
                )}
                {c.hasWrite ? (
                  c.status.write === null ? (
                    <span className="tag" style={{ color: "var(--green)" }}>write ok</span>
                  ) : (
                    <span className="tag" style={{ color: "var(--red)" }} title={c.status.write ?? ""}>write failed</span>
                  )
                ) : (
                  <span className="tag">read-only</span>
                )}
              </div>
              <div className="text-[12.5px] mt-1 code" style={{ color: "var(--text-dim)" }}>
                {c.host}:{c.port}/{c.database}
              </div>
            </div>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                if (confirm(`Remove connection "${c.name}"? (The database itself is untouched.)`)) {
                  deleteMutation.mutate(c.id);
                }
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {connections?.length === 0 && !showForm && (
          <div className="panel px-6 py-10 text-center">
            <p className="text-[14px] mb-1">No connections yet</p>
            <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
              Add your first Postgres database to get a browsable console in seconds.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
