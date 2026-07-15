"use client";

// Create/edit a connection. Supports pasting a full connection URI
// (postgres://, mysql://, mongodb://), and a "Test connection" probe that runs
// before saving.
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseConnectionUri } from "@/lib/parse-uri";
import { DB_ENGINES, DEFAULT_PORTS, type DbEngine } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataSelect } from "@/components/ui/data-select";
import { Switch } from "@/components/ui/switch";
import { EngineIcon, ENGINE_LABELS } from "@/components/engine-icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatabaseSelect } from "./database-select";
import { useCatalog } from "@/components/browse/use-catalog";
import { useConnections } from "@/app/settings/use-connections";

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
  options?: string | null;
  disabled: boolean;
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
  options: string;
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
  options: "",
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
        options: initial.options ?? "",
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
  const [activeTab, setActiveTab] = useState<"uri" | "manual">(mode === "create" && !initial ? "uri" : "manual");
  // The URI tab has no read/write user split like Manual Fields does — a
  // pasted URI is one set of credentials, so this decides whether that set
  // also becomes the write role or the connection is saved read-only.
  const [uriAccess, setUriAccess] = useState<"readwrite" | "readonly">("readwrite");
  const [useSeparateReadWrite, setUseSeparateReadWrite] = useState<boolean>(
    initial
      ? !!initial.writeUser && initial.writeUser !== initial.readUser
      : false
  );
  const isDuplicate = mode === "create" && !!initial;
  const passwordPlaceholder = mode === "edit"
    ? "•••• unchanged"
    : isDuplicate
      ? "•••• cloned (credentials loaded)"
      : "";

  // Write credentials to actually send: on the URI tab it's the readwrite/
  // readonly switch (a pasted URI is a single set of creds); on Manual
  // Fields it's the existing separate-user checkbox.
  const isUriTab = activeTab === "uri";
  const wUser = isUriTab
    ? uriAccess === "readonly" ? null : (form.writeUser || null)
    : useSeparateReadWrite ? (form.writeUser || null) : form.readUser;
  const wPass = isUriTab
    ? uriAccess === "readonly" ? null : (form.writePassword || null)
    : useSeparateReadWrite ? (form.writePassword || null) : form.readPassword;
  const willTestWrite = isUriTab ? uriAccess === "readwrite" : !!(useSeparateReadWrite ? form.writeUser : form.readUser);

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
      setUriMsg("Not a valid postgres://, mysql:// or mongodb:// URI");
      return;
    }
    setUriMsg(
      `Parsed ✓ ${ENGINE_LABELS[p.engine]} — credentials filled`,
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
      options: p.options ?? "",
    }));
  };

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: initial ? initial.id : undefined,
          engine: form.engine,
          host: form.host,
          port: Number(form.port),
          database: form.database,
          readUser: form.readUser,
          readPassword: form.readPassword,
          writeUser: wUser,
          writePassword: wPass,
          ssl: form.ssl,
          options: form.options || null,
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
        options: form.options || null,
      };
      if (mode === "create") {
        const res = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...base,
            cloneFrom: initial ? initial.id : undefined,
            readPassword: form.readPassword,
            writeUser: wUser,
            writePassword: wPass,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to add connection");
        return;
      }
      // edit: only send passwords the user actually typed (blank = unchanged)
      const patch: Record<string, unknown> = {
        ...base,
        writeUser: wUser,
      };
      if (form.readPassword) patch.readPassword = form.readPassword;
      if (useSeparateReadWrite) {
        if (form.writePassword) patch.writePassword = form.writePassword;
      } else {
        if (form.readPassword) patch.writePassword = form.readPassword;
      }
      const res = await fetch(`/api/connections/${initial!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update connection");
    },
    onSuccess: () => {
      useConnections.invalidate(qc);
      useCatalog.invalidate(qc);
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

        {/* Tab Switcher */}
        {mode === "create" && (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "uri" | "manual")}
            className="mb-4"
          >
            <TabsList className="w-full border-b border-border flex justify-start">
              <TabsTrigger value="uri" className="px-4 py-2">Connection URI</TabsTrigger>
              <TabsTrigger value="manual" className="px-4 py-2">Manual Fields</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {activeTab === "uri" ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="label">Name (identifier, e.g. users_service)</label>
              <Input value={form.name} onChange={set("name")} placeholder="users_service" className="w-full" />
            </div>
            <div>
              <label className="label">Connection URI</label>
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
            <div>
              <label className="label">Access</label>
              <label className="flex items-center gap-2 text-[13px] select-none cursor-pointer">
                <Switch
                  checked={uriAccess === "readwrite"}
                  onCheckedChange={(checked) => setUriAccess(checked ? "readwrite" : "readonly")}
                />
                {uriAccess === "readwrite" ? "Read-write" : "Read-only"}
              </label>
              <p className="text-[12px] mt-1" style={{ color: "var(--muted-foreground)" }}>
                {uriAccess === "readonly"
                  ? "Saved without write credentials — this connection can only be browsed, not edited."
                  : "The URI's credentials are used for both reading and writing."}
              </p>
            </div>
          </div>
        ) : (
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
              <label className="label">Host</label>
              <Input value={form.host} onChange={set("host")} />
            </div>
            <div>
              <label className="label">Port</label>
              <Input value={form.port} onChange={set("port")} />
            </div>
          </div>
        )}

        {activeTab === "manual" && (
          <div className="border-t border-border pt-4 mt-2">
            <h3 className="text-sm font-semibold mb-3">Database Credentials</h3>
            {!useSeparateReadWrite ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Username</label>
                  <Input value={form.readUser} onChange={set("readUser")} placeholder="db_user" />
                </div>
                <div>
                  <label className="label">Password</label>
                  <Input
                    type="password"
                    value={form.readPassword}
                    onChange={set("readPassword")}
                    placeholder={passwordPlaceholder}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
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
                    placeholder={passwordPlaceholder}
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
                    placeholder={passwordPlaceholder}
                  />
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[13px] select-none cursor-pointer" style={{ color: "var(--muted-foreground)" }}>
                <input
                  type="checkbox"
                  checked={useSeparateReadWrite}
                  onChange={(e) => setUseSeparateReadWrite(e.target.checked)}
                />{" "}
                Use separate read-only user (recommended for production)
              </label>

              <label className="flex items-center gap-2 text-[13px] select-none cursor-pointer" style={{ color: "var(--muted-foreground)" }}>
                <input type="checkbox" checked={form.ssl} onChange={set("ssl")} /> Use SSL
              </label>
            </div>

            <div className="border-t border-border pt-4 mt-4">
              <DatabaseSelect
                value={form.database}
                onChange={(val) => setForm((f) => ({ ...f, database: val }))}
                connectionId={initial?.id}
                engine={form.engine}
                host={form.host}
                port={form.port}
                readUser={form.readUser}
                readPassword={form.readPassword}
                ssl={form.ssl}
                options={form.options}
              />
            </div>

            {form.engine === "mongo" && (
              <div className="border-t border-border pt-4 mt-4">
                <label className="label">Advanced options</label>
                <Input
                  className="code w-full"
                  placeholder="authSource=admin&directConnection=true&readPreference=secondary"
                  value={form.options}
                  onChange={set("options")}
                />
                <p className="text-[12px] mt-1" style={{ color: "var(--muted-foreground)" }}>
                  Extra MongoDB driver options as URL query params, appended to the connection
                  string (e.g. <code>authSource</code>, <code>replicaSet</code>,{" "}
                  <code>readPreference</code>). Lizard defaults to <code>directConnection=true</code>{" "}
                  for a single host.
                </p>
              </div>
            )}
          </div>
        )}

        {testResult && (
          <div className="flex items-center gap-2">
            {statusPill("read", testResult.read)}
            {willTestWrite && statusPill("write", testResult.write)}
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

        <div className="flex items-center gap-2 mt-4">
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
