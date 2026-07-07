"use client";

// Create/edit a connection. Supports pasting a full postgres:// URI (parsed
// via new URL()), and a "Test connection" probe that runs before saving.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parsePostgresUri } from "@/lib/parse-uri";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface ConnectionRow {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  readUser: string;
  writeUser: string | null;
  hasWrite: boolean;
  ssl: boolean;
}

interface FormState {
  name: string;
  host: string;
  port: string;
  database: string;
  readUser: string;
  readPassword: string;
  writeUser: string;
  writePassword: string;
  ssl: boolean;
}

const BLANK: FormState = {
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

export function ConnectionForm({
  mode,
  initial,
  onClose,
}: {
  mode: "create" | "edit";
  initial?: ConnectionRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          name: initial.name,
          host: initial.host,
          port: String(initial.port),
          database: initial.database,
          readUser: initial.readUser,
          readPassword: "",
          writeUser: initial.writeUser ?? "",
          writePassword: "",
          ssl: initial.ssl,
        }
      : BLANK,
  );
  const [uri, setUri] = useState("");
  const [uriMsg, setUriMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    read: string | null;
    write: string | null;
  } | null>(null);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  const applyUri = (raw: string) => {
    setUri(raw);
    setTestResult(null);
    if (!raw.trim()) {
      setUriMsg(null);
      return;
    }
    const p = parsePostgresUri(raw);
    if (!p) {
      setUriMsg("Not a valid postgres:// URI");
      return;
    }
    setUriMsg("Parsed ✓ — read & write credentials filled (adjust write role if it differs)");
    setForm((f) => ({
      ...f,
      name: f.name || p.name,
      host: p.host,
      port: String(p.port),
      database: p.database,
      readUser: p.user,
      readPassword: p.password,
      writeUser: p.user,
      writePassword: p.password,
      ssl: p.ssl,
    }));
  };

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: form.host,
          port: Number(form.port),
          database: form.database,
          readUser: form.readUser,
          readPassword: form.readPassword,
          writeUser: form.writeUser || null,
          writePassword: form.writePassword || null,
          ssl: form.ssl,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Test failed");
      return body as { read: string | null; write: string | null };
    },
    onSuccess: (r) => {
      setTestResult(r);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const base = {
        name: form.name,
        host: form.host,
        port: Number(form.port),
        database: form.database,
        readUser: form.readUser,
        ssl: form.ssl,
      };
      if (mode === "create") {
        const res = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...base,
            readPassword: form.readPassword,
            writeUser: form.writeUser || null,
            writePassword: form.writePassword || null,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to add connection");
        return;
      }
      // edit: only send passwords the user actually typed (blank = unchanged)
      const patch: Record<string, unknown> = {
        ...base,
        writeUser: form.writeUser || null,
      };
      if (form.readPassword) patch.readPassword = form.readPassword;
      if (form.writePassword) patch.writePassword = form.writePassword;
      const res = await fetch(`/api/connections/${initial!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update connection");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const statusPill = (label: string, result: string | null) =>
    result === null ? (
      <span className="tag" style={{ color: "var(--success)" }}>
        {label} ok
      </span>
    ) : (
      <span className="tag" style={{ color: "var(--destructive)" }} title={result}>
        {label} failed
      </span>
    );

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "var(--overlay)" }} onClick={onClose} />
      <Card className="fixed z-50 inset-x-0 top-[5vh] mx-auto w-[640px] max-w-[94vw] p-6 max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold">
            {mode === "create" ? "Add connection" : `Edit “${initial?.name}”`}
          </h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="mb-4">
          <label className="label">Paste a connection URI (optional)</label>
          <input
            className="input code"
            placeholder="postgres://user:password@host:5432/database?sslmode=require"
            value={uri}
            onChange={(e) => applyUri(e.target.value)}
          />
          {uriMsg && (
            <p
              className="text-[12px] mt-1"
              style={{
                color: uriMsg.startsWith("Parsed") ? "var(--success)" : "var(--warning)",
              }}
            >
              {uriMsg}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Name (identifier, e.g. users_service)</label>
            <input className="input" value={form.name} onChange={set("name")} placeholder="users_service" />
          </div>
          <div>
            <label className="label">Database</label>
            <input className="input" value={form.database} onChange={set("database")} />
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
            <input
              className="input"
              type="password"
              value={form.readPassword}
              onChange={set("readPassword")}
              placeholder={mode === "edit" ? "•••• unchanged" : ""}
            />
          </div>
          <div>
            <label className="label">Write user (optional — enables CRUD)</label>
            <input className="input" value={form.writeUser} onChange={set("writeUser")} placeholder="lizard_write" />
          </div>
          <div>
            <label className="label">Write password</label>
            <input
              className="input"
              type="password"
              value={form.writePassword}
              onChange={set("writePassword")}
              placeholder={mode === "edit" ? "•••• unchanged" : ""}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 mt-4 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          <input type="checkbox" checked={form.ssl} onChange={set("ssl")} /> Use SSL
        </label>

        {testResult && (
          <div className="flex items-center gap-2 mt-4">
            {statusPill("read", testResult.read)}
            {form.writeUser && statusPill("write", testResult.write)}
            {testResult.read && (
              <span className="text-[12px]" style={{ color: "var(--destructive)" }}>
                {testResult.read}
              </span>
            )}
          </div>
        )}
        {error && (
          <p className="mt-3 text-[13px]" style={{ color: "var(--destructive)" }}>
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <Button
            variant="outline"
            disabled={testMutation.isPending || !form.host || !form.database || !form.readUser}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? "Testing…" : "Test connection"}
          </Button>
          <span className="flex-1" />
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving…" : mode === "create" ? "Save connection" : "Save changes"}
          </Button>
        </div>
      </Card>
    </>
  );
}
