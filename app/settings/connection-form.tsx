"use client";

// Create/edit a connection. Supports pasting a full connection URI
// (postgres://, mysql://, mongodb://), and a "Test connection" probe that runs
// before saving.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseConnectionUri } from "@/lib/parse-uri";
import { DB_ENGINES, DEFAULT_PORTS, type DbEngine } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataSelect } from "@/components/ui/data-select";
import { EngineIcon, ENGINE_LABELS } from "@/components/engine-icon";

export interface ConnectionRow {
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  readUser: string;
  writeUser: string | null;
  hasWrite: boolean;
  ssl: boolean;
}

interface FormState {
  engine: DbEngine;
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
  engine: "postgres",
  name: "",
  host: "localhost",
  port: String(DEFAULT_PORTS.postgres),
  database: "",
  readUser: "",
  readPassword: "",
  writeUser: "",
  writePassword: "",
  ssl: false,
};

// URI placeholder per engine, so the field shows a relevant example.
const URI_PLACEHOLDER: Record<DbEngine, string> = {
  postgres: "postgres://user:password@host:5432/database?sslmode=require",
  mysql: "mysql://user:password@host:3306/database",
  mongo: "mongodb://user:password@host:27017/database",
};

export function ConnectionForm({
  mode,
  initial,
  onClose,
}: {
  mode: "create" | "edit" | null;
  initial?: ConnectionRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          engine: initial.engine,
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

  // Switching engine swaps the port to the new engine's default when the
  // current port is still a (any engine's) default — so a hand-typed port is
  // never clobbered, but the common case just works.
  const setEngine = (engine: DbEngine) => {
    setTestResult(null);
    setForm((f) => {
      const portIsDefault = Object.values(DEFAULT_PORTS).some((p) => String(p) === f.port) || f.port === "";
      return { ...f, engine, port: portIsDefault ? String(DEFAULT_PORTS[engine]) : f.port };
    });
  };

  const applyUri = (raw: string) => {
    setUri(raw);
    setTestResult(null);
    if (!raw.trim()) {
      setUriMsg(null);
      return;
    }
    const p = parseConnectionUri(raw);
    if (!p) {
      setUriMsg("Not a valid postgres:// , mysql:// or mongodb:// URI");
      return;
    }
    setUriMsg(
      `Parsed ✓ ${ENGINE_LABELS[p.engine]} — read & write credentials filled (adjust write role if it differs)`,
    );
    setForm((f) => ({
      ...f,
      engine: p.engine,
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
          engine: form.engine,
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
        engine: form.engine,
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
    <Dialog open={Boolean(mode)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton
        className="w-160 max-w-[94vw] sm:max-w-160 max-h-[90vh] overflow-y-auto scrollbar-thin"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <EngineIcon engine={form.engine} className="size-5" />
            {mode === "create" ? "Add connection" : `Edit “${initial?.name}”`}
          </DialogTitle>
        </DialogHeader>

        <div>
          <label className="label">Paste a connection URI (optional)</label>
          <Input
            className="code"
            placeholder={URI_PLACEHOLDER[form.engine]}
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
            <label className="label">Engine</label>
            <DataSelect
              items={DB_ENGINES}
              value={form.engine}
              onChange={(e) => e && setEngine(e)}
              getValue={(e) => e}
              getLabel={(e) => (
                <>
                  <EngineIcon engine={e} className="size-4" />
                  {ENGINE_LABELS[e]}
                </>
              )}
              className="w-full"
            />
          </div>
          <div>
            <label className="label">Name (identifier, e.g. users_service)</label>
            <Input value={form.name} onChange={set("name")} placeholder="users_service" />
          </div>
          <div>
            <label className="label">Database</label>
            <Input value={form.database} onChange={set("database")} />
          </div>
          <div>
            <label className="label">Host</label>
            <Input value={form.host} onChange={set("host")} />
          </div>
          <div>
            <label className="label">Port</label>
            <Input value={form.port} onChange={set("port")} />
          </div>
          <div>
            <label className="label">Read user (SELECT-only role)</label>
            <Input value={form.readUser} onChange={set("readUser")} placeholder="lizard_read" />
          </div>
          <div>
            <label className="label">Read password</label>
            <Input
              type="password"
              value={form.readPassword}
              onChange={set("readPassword")}
              placeholder={mode === "edit" ? "•••• unchanged" : ""}
            />
          </div>
          <div>
            <label className="label">Write user (optional — enables CRUD)</label>
            <Input value={form.writeUser} onChange={set("writeUser")} placeholder="lizard_write" />
          </div>
          <div>
            <label className="label">Write password</label>
            <Input
              type="password"
              value={form.writePassword}
              onChange={set("writePassword")}
              placeholder={mode === "edit" ? "•••• unchanged" : ""}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          <input type="checkbox" checked={form.ssl} onChange={set("ssl")} /> Use SSL
        </label>

        {testResult && (
          <div className="flex items-center gap-2">
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
          <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={testMutation.isPending || !form.host || !form.database || !form.readUser}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? "Testing…" : "Test connection"}
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving…" : mode === "create" ? "Save connection" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
