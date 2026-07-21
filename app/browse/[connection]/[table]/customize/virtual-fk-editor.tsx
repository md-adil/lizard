"use client";

// Relationships section of the table customization page. Inline (no modal) —
// the source side (schema/table) is governed by the page's scope, so this only
// asks for the target and the join. Composite keys and constant filters are
// always available.
import { useState, useMemo } from "react";
import type { VfkPair, VfkConstant, TableInfo } from "@/lib/types";
import { SAME_SCHEMA } from "@/lib/introspect/virtual-fk";
import { effectiveKey } from "@/lib/introspect/heuristics";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ColumnsSelect } from "@/components/browse/columns-select";
import { DataSelect } from "@/components/ui/data-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ForeignKeyLists } from "@/components/browse/fk-lists";
import {
  useSchemaMeta,
  connectionSupportsSchemas,
  type TableMeta,
  type CatalogResponse,
} from "@/components/browse/useTableMeta";
import { useConnectionSchemas } from "@/components/browse/use-connection-schemas";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxSeparator,
  ComboboxEmpty,
  ComboboxCollection,
} from "@/components/ui/combobox";
export function VirtualFkEditor({
  meta,
  catalog,
  schemaTables,
  fromSchema,
  fromTable,
  defaultToSchema,
  onSaved,
}: {
  meta: TableMeta;
  catalog: CatalogResponse;
  // Every table in this table's own schema — scanned for real FKs pointing
  // back at this table, so the "incoming" list below has something to read.
  schemaTables: TableInfo[];
  // Source side, fixed by the page scope (a concrete schema or a glob pattern).
  fromSchema: string;
  fromTable: string;
  // "$schema" when the page is scoped to a pattern, else the concrete schema.
  defaultToSchema: string;
  onSaved: () => void;
}) {
  // simple: target locked to the current connection + schema (missing-FK case).
  // advanced: pick a target in any connection/schema (cross-service).
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [toConnection, setToConnection] = useState(meta.connection);
  const [toSchema, setToSchema] = useState(defaultToSchema);
  const [toTable, setToTable] = useState("");
  const [pairs, setPairs] = useState<VfkPair[]>([{ from: "", to: "" }]);
  const [constants, setConstants] = useState<VfkConstant[]>([]);
  const [label, setLabel] = useState("");
  const [joinHint, setJoinHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const toConn = catalog.connections.find((c) => c.connectionName === toConnection);
  // The target is user-picked, so it may be a different connection (and
  // engine) than the source — its schema eligibility has to be looked up.
  // When it has none, the schema select is hidden and the server resolves the
  // connection's single schema for us.
  const toConnHasSchema = !!toConnection && connectionSupportsSchemas(catalog, toConnection);
  // Only fetched for a target that can actually have more than one schema
  // (Postgres) — a MySQL/Mongo target's one schema is just its database
  // name, already known from `catalog`, no query needed at all.
  const { schemas: toConnSchemas, isLoading: toSchemasLoading } = useConnectionSchemas(
    toConnHasSchema ? toConnection : undefined,
  );
  // $schema has no single concrete schema — introspect the source table's own
  // schema in the target connection as a stand-in.
  const repSchemaName = !toConnHasSchema ? undefined : toSchema === SAME_SCHEMA ? meta.resolvedSchema : toSchema;
  const { schemaMeta: targetSchemaMeta } = useSchemaMeta(toConnection || undefined, repSchemaName);
  const targetTable = targetSchemaMeta?.tables.find((t) => t.name === toTable);
  const targetColumns = targetTable?.columns ?? [];
  // O(1) name lookups for the join-pair pickers below instead of re-scanning
  // the column list (which can run into the hundreds) on every render.
  const sourceColumnsByName = useMemo(() => new Map(meta.table.columns.map((c) => [c.name, c])), [meta.table.columns]);
  const targetColumnsByName = useMemo(() => new Map(targetColumns.map((c) => [c.name, c])), [targetColumns]);

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
    setPairs([{ from: "", to: "" }]);
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
    const pk = effectiveKey(target)[0] ?? target.columns[0]?.name ?? "";
    const guessFrom =
      meta.table.columns.find((c) => c.name === `${t}_id`)?.name ??
      meta.table.columns.find((c) => c.name === `${t.replace(/s$/, "")}_id`)?.name ??
      "";
    setPairs((s) => (s.length === 1 && !s[0].from && !s[0].to ? [{ from: guessFrom, to: pk }] : s));
  }

  async function submit() {
    setError(null);
    if (!toConn) {
      setError("Pick a target connection");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/virtual-fks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // stable connection ids, not names — a rename must not orphan this
          // relationship (see the VirtualFk type comment).
          fromConnection: meta.connectionId,
          fromSchema,
          fromTable,
          toConnection: toConn.connectionId,
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
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/virtual-fks/${id}`, { method: "DELETE" });
      onSaved();
    } finally {
      setDeletingId(null);
    }
  }

  // vfk.toConnection is a connection id — resolve it to a display name for
  // the existing-relationships list (vfkSummary stays catalog-free/pure).
  const connectionNameById = new Map(catalog.connections.map((c) => [c.connectionId, c.connectionName]));
  const resolveConnectionName = (id: string) => connectionNameById.get(id) ?? id;

  return (
    <div className="grid md:grid-cols-2 gap-6 items-start">
      <Card className="p-4 gap-3">
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
                <DataSelect
                  items={catalog.connections}
                  value={catalog.connections.find((c) => c.connectionName === toConnection) ?? null}
                  onChange={(picked) => {
                    const name = picked?.connectionName ?? "";
                    setToConnection(name);
                    setToTable("");
                    // A connection without schemas has exactly one, named
                    // after its database — pick it for the user, since
                    // there's no schema select to do it (and no query needed
                    // either: that name is already known from `catalog`).
                    const hasSchema = !!name && connectionSupportsSchemas(catalog, name);
                    setToSchema(!picked || hasSchema ? "" : picked.database);
                  }}
                  getValue={(c) => c.connectionName}
                  getLabel={(c) => c.connectionName}
                  placeholder="— select —"
                  className="w-full"
                />
              </div>
              {toConnHasSchema && (
                <div>
                  <label className="label">Target schema</label>
                  <DataSelect
                    items={[
                      { value: SAME_SCHEMA, label: "Same schema as row" },
                      ...toConnSchemas.map((s) => ({ value: s.name, label: s.name })),
                    ]}
                    value={toSchema ? { value: toSchema, label: toSchema } : null}
                    disabled={!toConn}
                    loading={toSchemasLoading}
                    onChange={(o) => {
                      setToSchema(o?.value ?? "");
                      setToTable("");
                    }}
                    placeholder="— select —"
                    className="w-full"
                  />
                </div>
              )}
            </>
          )}
          <div>
            <label className="label">{showTargetScope ? "Target table" : "References table"}</label>
            <Combobox
              items={targetSchemaMeta?.tables.map((t) => t.name) ?? []}
              value={toTable}
              onValueChange={(val) => {
                if (val) pickTable(val);
              }}
              disabled={!toSchema}
            >
              <ComboboxInput placeholder="— select table —" className="w-full" disabled={!toSchema} />
              <ComboboxContent>
                <ComboboxEmpty>No tables found</ComboboxEmpty>
                <ComboboxList>
                  {(t) => (
                    <ComboboxItem key={t} value={t}>
                      {t}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
        </div>

        <div>
          <label className="label">Join on</label>
          <div className="space-y-2">
            {pairs.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <ColumnsSelect
                  items={meta.table.columns}
                  value={sourceColumnsByName.get(p.from) ?? null}
                  onChange={(col) => setPair(i, { from: col?.name ?? "" })}
                  placeholder="— this column —"
                  className="flex-1"
                />
                <span className="shrink-0" style={{ color: "var(--muted-foreground-faint)" }}>
                  =
                </span>
                <ColumnsSelect
                  items={targetColumns}
                  value={targetColumnsByName.get(p.to) ?? null}
                  onChange={(col) => setPair(i, { to: col?.name ?? "" })}
                  placeholder="— target column —"
                  className="flex-1"
                  disabled={!targetTable}
                />
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="shrink-0"
                  disabled={pairs.length === 1}
                  onClick={() => setPairs((s) => s.filter((_, idx) => idx !== i))}
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setPairs((s) => [...s, { from: "", to: "" }])}>
              + Add column (composite key)
            </Button>
          </div>
        </div>

        <div>
          <label className="label">Constant filters (optional)</label>
          <div className="space-y-2">
            {constants.map((c, i) => {
              const sourceColItems = meta.table.columns.map((sc) => ({
                id: `source::${sc.name}`,
                label: sc.name,
              }));
              const targetColItems = targetColumns.map((tc) => ({
                id: `target::${tc.name}`,
                label: tc.name,
              }));
              const allConstantItems = [...sourceColItems, ...targetColItems];

              return (
                <div key={i} className="flex items-center gap-2">
                  <Combobox
                    items={allConstantItems}
                    value={c.toColumn ? `${c.side || "target"}::${c.toColumn}` : ""}
                    onValueChange={(val: any) => {
                      if (!val) {
                        setConst(i, { toColumn: "", side: "target" });
                      } else {
                        const [side, col] = val.split("::");
                        setConst(i, { toColumn: col, side: side as "source" | "target" });
                      }
                    }}
                    disabled={!targetTable}
                  >
                    <ComboboxInput placeholder="— select column —" className="flex-1" disabled={!targetTable} />
                    <ComboboxContent>
                      <ComboboxEmpty>No columns found</ComboboxEmpty>
                      <ComboboxList>
                        <ComboboxGroup items={sourceColItems}>
                          <ComboboxLabel>Source: {fromTable}</ComboboxLabel>
                          <ComboboxCollection>
                            {(item: any) => (
                              <ComboboxItem key={item.id} value={item.id}>
                                {item.label}
                              </ComboboxItem>
                            )}
                          </ComboboxCollection>
                        </ComboboxGroup>
                        {targetTable && (
                          <>
                            <ComboboxSeparator />
                            <ComboboxGroup items={targetColItems}>
                              <ComboboxLabel>Target: {toTable}</ComboboxLabel>
                              <ComboboxCollection>
                                {(item: any) => (
                                  <ComboboxItem key={item.id} value={item.id}>
                                    {item.label}
                                  </ComboboxItem>
                                )}
                              </ComboboxCollection>
                            </ComboboxGroup>
                          </>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <span className="shrink-0" style={{ color: "var(--muted-foreground-faint)" }}>
                    =
                  </span>
                  <Input
                    className="flex-1"
                    placeholder="value, e.g. user"
                    value={c.value}
                    onChange={(e) => setConst(i, { value: e.target.value })}
                  />
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="shrink-0"
                    onClick={() => setConstants((s) => s.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </Button>
                </div>
              );
            })}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConstants((s) => [...s, { toColumn: "", side: "target", value: "" }])}
            >
              + Add constant filter
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Label (optional)</label>
            <Input placeholder="e.g. Owner" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <label className="label">AI join hint (optional)</label>
            <Input
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
          <Button variant="secondary" onClick={reset}>
            Reset
          </Button>
        </div>
      </Card>

      <div>
        {/* user-added (custom) relationships lead — the whole point of this
            tab is managing these, so they shouldn't be buried below the
            read-only native/incoming sections every table already has. */}
        <ForeignKeyLists
          table={meta.table}
          schemaTables={schemaTables}
          virtualFks={meta.virtualFks}
          resolveConnectionName={resolveConnectionName}
          deletingId={deletingId}
          onDeleteVirtualFk={remove}
          saving={saving}
        />
      </div>
    </div>
  );
}
