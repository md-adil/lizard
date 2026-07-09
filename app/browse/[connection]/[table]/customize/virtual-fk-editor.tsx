"use client";

// Relationships section of the table customization page. Inline (no modal) —
// the source side (schema/table) is governed by the page's scope, so this only
// asks for the target and the join. Composite keys, value transforms and
// constant filters are always available.
import { useState } from "react";
import type { VfkTransform, VfkPair, VfkConstant } from "@/lib/types";
import { SAME_SCHEMA, vfkSummary } from "@/lib/introspect/virtual-fk";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useSchemaMeta,
  connectionSupportsSchemas,
  type TableMeta,
  type CatalogResponse,
} from "@/components/browse/useTableMeta";

const TRANSFORMS: { value: VfkTransform; label: string }[] = [
  { value: "none", label: "exact" },
  { value: "lower", label: "lower()" },
  { value: "upper", label: "upper()" },
  { value: "trim", label: "trim()" },
];

export function VirtualFkEditor({
  meta,
  catalog,
  fromSchema,
  fromTable,
  defaultToSchema,
  onSaved,
}: {
  meta: TableMeta;
  catalog: CatalogResponse;
  // Source side, fixed by the page scope (a concrete schema or a glob pattern).
  fromSchema: string;
  fromTable: string;
  // "$schema" when the page is scoped to a pattern, else the concrete schema.
  defaultToSchema: string;
  onSaved: () => void;
}) {
  const [adding, setAdding] = useState(false);
  // simple: target locked to the current connection + schema (missing-FK case).
  // advanced: pick a target in any connection/schema (cross-service).
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [toConnection, setToConnection] = useState(meta.connection);
  const [toSchema, setToSchema] = useState(defaultToSchema);
  const [toTable, setToTable] = useState("");
  const [pairs, setPairs] = useState<VfkPair[]>([{ from: "", to: "", transform: "none" }]);
  const [constants, setConstants] = useState<VfkConstant[]>([]);
  const [label, setLabel] = useState("");
  const [joinHint, setJoinHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toConn = catalog.connections.find((c) => c.connectionName === toConnection);
  // The target is user-picked, so it may be a different connection (and
  // engine) than the source — its schema eligibility has to be looked up.
  // When it has none, the schema select is hidden and the server resolves the
  // connection's single schema for us.
  const toConnHasSchema = !!toConnection && connectionSupportsSchemas(catalog, toConnection);
  // $schema has no single concrete schema — introspect the source table's own
  // schema in the target connection as a stand-in.
  const repSchemaName = !toConnHasSchema ? undefined : toSchema === SAME_SCHEMA ? meta.resolvedSchema : toSchema;
  const { schemaMeta: targetSchemaMeta } = useSchemaMeta(toConnection || undefined, repSchemaName);
  const targetTable = targetSchemaMeta?.tables.find((t) => t.name === toTable);
  const targetColumns = targetTable?.columns ?? [];

  const pairsFilled = pairs.length > 0 && pairs.every((p) => p.from && p.to);
  const canAdd = !!toConnection && !!toSchema && !!toTable && pairsFilled;
  const showTargetScope = mode === "advanced";

  function switchMode(m: "simple" | "advanced") {
    setMode(m);
    if (m === "simple") {
      // re-lock the target to the current connection + page-scoped schema
      setToConnection(meta.connection);
      setToSchema(defaultToSchema);
      setToTable("");
    }
  }

  function setPair(i: number, patch: Partial<VfkPair>) {
    setPairs((s) => s.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function setConst(i: number, patch: Partial<VfkConstant>) {
    setConstants((s) => s.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function reset() {
    setMode("simple");
    setToConnection(meta.connection);
    setToSchema(defaultToSchema);
    setToTable("");
    setPairs([{ from: "", to: "", transform: "none" }]);
    setConstants([]);
    setLabel("");
    setJoinHint("");
    setError(null);
  }

  // When a target table is picked, guess a sensible first pair.
  function pickTable(t: string) {
    setToTable(t);
    const target = targetSchemaMeta?.tables.find((x) => x.name === t);
    if (!target) return;
    const pk = target.primaryKey[0] ?? target.columns[0]?.name ?? "";
    const guessFrom =
      meta.table.columns.find((c) => c.name === `${t}_id`)?.name ??
      meta.table.columns.find((c) => c.name === `${t.replace(/s$/, "")}_id`)?.name ??
      "";
    setPairs((s) => (s.length === 1 && !s[0].from && !s[0].to ? [{ from: guessFrom, to: pk, transform: "none" }] : s));
  }

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/virtual-fks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromConnection: meta.connection,
          fromSchema,
          fromTable,
          toConnection,
          toSchema,
          toTable,
          pairs,
          constants: constants.filter((c) => c.toColumn),
          label: label || null,
          joinHint: joinHint || null,
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Failed to save");
        return;
      }
      reset();
      setAdding(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/virtual-fks/${id}`, { method: "DELETE" });
    onSaved();
  }

  return (
    <div>
      {meta.virtualFks.map((v) => (
        <Card key={v.id} size="sm" className="px-3 py-2.5 mb-2 flex-row items-start justify-between gap-2">
          <div className="min-w-0">
            {v.label && <div className="font-medium mb-0.5">{v.label}</div>}
            <span className="code wrap-break-word" style={{ fontSize: 11.5 }}>
              {v.fromSchema}.{v.fromTable} → {vfkSummary(v)}
            </span>
          </div>
          <Button variant="outline" size="icon-sm" className="shrink-0" onClick={() => remove(v.id)}>
            ✕
          </Button>
        </Card>
      ))}

      {!adding ? (
        <Button variant="outline" className="mt-1" onClick={() => setAdding(true)}>
          + Add relationship
        </Button>
      ) : (
        <Card className="p-4 mt-2 gap-3">
          <div>
            <div className="text-[11px] mb-1.5" style={{ color: "var(--muted-foreground-faint)" }}>
              Target
            </div>
            <Tabs value={mode} onValueChange={(v) => switchMode(v as "simple" | "advanced")}>
              <TabsList variant="default">
                <TabsTrigger value="simple">Simple (same schema)</TabsTrigger>
                <TabsTrigger value="advanced">Advanced (cross-service)</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <p className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            Links{" "}
            <span className="code">
              {fromSchema}.{fromTable}
            </span>{" "}
            to a target table. Source scope follows this page.
          </p>

          <div
            className={`grid gap-3 ${showTargetScope ? (toConnHasSchema ? "grid-cols-3" : "grid-cols-2") : "grid-cols-1"}`}
          >
            {showTargetScope && (
              <>
                <div>
                  <label className="label">Target connection</label>
                  <select
                    className="input"
                    value={toConnection}
                    onChange={(e) => {
                      const name = e.target.value;
                      setToConnection(name);
                      setToTable("");
                      // A connection without schemas has exactly one — pick it for
                      // the user, since there's no schema select to do it.
                      const picked = catalog.connections.find((c) => c.connectionName === name);
                      const hasSchema = !!name && connectionSupportsSchemas(catalog, name);
                      setToSchema(!picked || hasSchema ? "" : (picked.schemas[0]?.name ?? ""));
                    }}
                  >
                    <option value="">— select —</option>
                    {catalog.connections.map((c) => (
                      <option key={c.connectionName} value={c.connectionName}>
                        {c.connectionName}
                      </option>
                    ))}
                  </select>
                </div>
                {toConnHasSchema && (
                  <div>
                    <label className="label">Target schema</label>
                    <select
                      className="input"
                      value={toSchema}
                      disabled={!toConn}
                      onChange={(e) => {
                        setToSchema(e.target.value);
                        setToTable("");
                      }}
                    >
                      <option value="">— select —</option>
                      <option value={SAME_SCHEMA}>Same schema as row</option>
                      {toConn?.schemas.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
            <div>
              <label className="label">{showTargetScope ? "Target table" : "References table"}</label>
              <select
                className="input"
                value={toTable}
                disabled={!toSchema}
                onChange={(e) => pickTable(e.target.value)}
              >
                <option value="">— select —</option>
                {targetSchemaMeta?.tables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Join on</label>
            <div className="space-y-2">
              {pairs.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className="input" value={p.from} onChange={(e) => setPair(i, { from: e.target.value })}>
                    <option value="">— this column —</option>
                    {meta.table.columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="shrink-0" style={{ color: "var(--muted-foreground-faint)" }}>
                    =
                  </span>
                  <select
                    className="input"
                    value={p.to}
                    disabled={!targetTable}
                    onChange={(e) => setPair(i, { to: e.target.value })}
                  >
                    <option value="">— target column —</option>
                    {targetColumns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input"
                    value={p.transform ?? "none"}
                    onChange={(e) => setPair(i, { transform: e.target.value as VfkTransform })}
                    title="Value transform applied to both sides"
                  >
                    {TRANSFORMS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="shrink-0"
                    disabled={pairs.length === 1}
                    onClick={() => setPairs((s) => s.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPairs((s) => [...s, { from: "", to: "", transform: "none" }])}
              >
                + Add column (composite key)
              </Button>
            </div>
          </div>

          <div>
            <label className="label">Constant filters (optional)</label>
            <div className="space-y-2">
              {constants.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className="input"
                    value={c.toColumn}
                    disabled={!targetTable}
                    onChange={(e) => setConst(i, { toColumn: e.target.value })}
                  >
                    <option value="">— target column —</option>
                    {targetColumns.map((tc) => (
                      <option key={tc.name} value={tc.name}>
                        {tc.name}
                      </option>
                    ))}
                  </select>
                  <span className="shrink-0" style={{ color: "var(--muted-foreground-faint)" }}>
                    =
                  </span>
                  <input
                    className="input"
                    placeholder="value, e.g. user"
                    value={c.value}
                    onChange={(e) => setConst(i, { value: e.target.value })}
                  />
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="shrink-0"
                    onClick={() => setConstants((s) => s.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConstants((s) => [...s, { toColumn: "", value: "" }])}
              >
                + Add constant filter
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Label (optional)</label>
              <input
                className="input"
                placeholder="e.g. Owner"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div>
              <label className="label">AI join hint (optional)</label>
              <input
                className="input"
                placeholder="free-text for complex joins"
                value={joinHint}
                onChange={(e) => setJoinHint(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="text-[12px]" style={{ color: "var(--destructive)" }}>
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button disabled={!canAdd || saving} onClick={submit}>
              {saving ? "Adding…" : "Add relationship"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                reset();
                setAdding(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
