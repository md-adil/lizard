"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTableMeta, connectionSupportsSchemas, formatCell, type TableMeta } from "@/components/browse/useTableMeta";
import { dataApiUrl } from "@/components/browse/data-api";
import type { VfkTransform } from "@/lib/types";
import { RowEditor } from "@/components/browse/row-editor";
import { RedactedValue } from "@/components/browse/redacted-value";
import { RecordComments } from "@/components/browse/record-comments";
import { LinkedRecordsCard } from "@/components/browse/linked-records-card";
import { DataGrid } from "@/components/browse/data-grid";
import { JsonView } from "@/components/browse/json-view";
import { useSchemaParam, tableHref, recordHref } from "@/components/browse/use-schema-param";
import { humanize } from "@/lib/introspect/heuristics";
import { SAME_SCHEMA, isPattern, vfkDisplayColumn } from "@/lib/introspect/virtual-fk";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

function RelatedCard({
  title,
  subtitle,
  menu,
  children,
}: {
  title: string;
  subtitle?: string;
  menu?: {
    label: string;
    onClick?: () => void;
    href?: string;
    danger?: boolean;
  }[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="p-4 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[13.5px] font-semibold truncate">{title}</span>
        {subtitle && (
          <span className="tag code" style={{ fontSize: 10 }}>
            {subtitle}
          </span>
        )}
        <span className="flex-1" />
        <Button variant="outline" size="sm" title="Enlarge" onClick={() => setExpanded(true)}>
          ⤢
        </Button>
        {menu && menu.length > 0 && (
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setOpen((s) => !s)}>
              ⋯
            </Button>
            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div
                  className="absolute right-0 z-20 mt-1 w-44 rounded-md border py-1"
                  style={{
                    background: "var(--muted)",
                    borderColor: "var(--input)",
                  }}
                >
                  {menu.map((m) =>
                    m.href ? (
                      <Link
                        key={m.label}
                        href={m.href}
                        className="block px-3 py-1.5 text-[12.5px] hoverable"
                        style={{
                          color: m.danger ? "var(--destructive)" : "var(--foreground)",
                        }}
                        onClick={() => setOpen(false)}
                      >
                        {m.label}
                      </Link>
                    ) : (
                      <Button
                        variant="ghost"
                        className="block w-full text-left px-3 py-1.5 text-[12.5px] hoverable"
                        key={m.label}
                        style={{
                          color: m.danger ? "var(--destructive)" : "var(--foreground)",
                        }}
                        onClick={() => {
                          setOpen(false);
                          m.onClick?.();
                        }}
                      >
                        {m.label}
                      </Button>
                    ),
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {children}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          showCloseButton
          className="top-[5vh] translate-y-0 flex flex-col resize overflow-auto gap-0 rounded-xl"
          style={{
            background: "var(--card)",
            width: "min(90vw, 1100px)",
            height: "min(60vh, 640px)",
            minWidth: 360,
            minHeight: 200,
            maxWidth: "95vw",
            maxHeight: "90vh",
          }}
        >
          <div className="flex items-center gap-2 mb-4 pr-6">
            <DialogTitle className="text-[16px] font-semibold">{title}</DialogTitle>
            {subtitle && (
              <span className="tag code" style={{ fontSize: 10 }}>
                {subtitle}
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin pr-1 text-[13.5px]">{children}</div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FieldList({
  meta,
  row,
  fkLabels,
}: {
  meta: TableMeta;
  row: Record<string, unknown>;
  fkLabels: Record<string, Record<string, string>>;
}) {
  const cols = meta.columns.filter((c) => !c.hidden && c.widget !== "json");
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
      {cols.map((cm) => {
        const v = row[cm.col.name];
        const label = cm.ref && v != null ? fkLabels[cm.col.name]?.[String(v)] : undefined;
        const f = formatCell(v);
        return (
          <div key={cm.col.name} className="min-w-0">
            <div
              className="text-[11px] font-medium uppercase tracking-wide"
              style={{ color: "var(--muted-foreground-faint)" }}
            >
              {cm.label}
            </div>
            <div
              className="text-[13px] truncate"
              style={{
                color: f.muted ? "var(--muted-foreground-faint)" : "var(--foreground)",
              }}
              title={cm.redacted ? undefined : f.text}
            >
              {cm.redacted ? (
                <RedactedValue value={v} />
              ) : label ? (
                <>
                  {label}{" "}
                  <span className="tag code" style={{ fontSize: 10 }}>
                    {String(v)}
                  </span>
                </>
              ) : (
                f.text
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// dedicated card per JSON column with inline editing
function JsonCard({
  meta,
  row,
  pk,
  column,
}: {
  meta: TableMeta;
  row: Record<string, unknown>;
  pk: Record<string, unknown>;
  column: string;
}) {
  const qc = useQueryClient();
  const stored = row[column];
  // A real json/jsonb column arrives already parsed into an object; a
  // text column with its widget overridden to "json" arrives as a raw
  // string that still needs parsing to render/edit as structured JSON.
  const value =
    typeof stored === "string" && stored.trim() !== ""
      ? (() => {
          try {
            return JSON.parse(stored);
          } catch {
            return stored;
          }
        })()
      : stored;
  const pretty = value == null ? "" : JSON.stringify(value, null, 2);
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(false);
  const [text, setText] = useState(pretty);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      let parsed: unknown = null;
      if (text.trim() !== "") {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("Invalid JSON");
        }
      }
      const res = await fetch(
        dataApiUrl({ connection: meta.connection, table: meta.table.name, path: "row", schema: meta.schema }),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pk, data: { [column]: parsed } }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
    },
    onSuccess: () => {
      setEditing(false);
      setErr(null);
      qc.invalidateQueries({ queryKey: ["record"] });
      qc.invalidateQueries({
        queryKey: ["rows", meta.connection, meta.schema, meta.table.name],
      });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const cm = meta.columns.find((c) => c.col.name === column);
  return (
    <RelatedCard
      title={cm?.label ?? humanize(column)}
      subtitle="json"
      menu={[
        ...(value != null
          ? [
              {
                label: raw ? "Show structured" : "Show raw JSON",
                onClick: () => setRaw((r) => !r),
              },
            ]
          : []),
        ...(meta.isView
          ? []
          : [
              editing
                ? {
                    label: "Cancel editing",
                    onClick: () => {
                      setEditing(false);
                      setText(pretty);
                      setErr(null);
                    },
                  }
                : {
                    label: "✎ Edit JSON",
                    onClick: () => {
                      setText(pretty);
                      setEditing(true);
                    },
                  },
            ]),
      ]}
    >
      {editing ? (
        <>
          <textarea className="input code w-full" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          {err && (
            <p className="text-[12px] mt-1" style={{ color: "var(--destructive)" }}>
              {err}
            </p>
          )}
          <Button size="sm" className="mt-2" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save JSON"}
          </Button>
        </>
      ) : value == null ? (
        <p className="text-[13px]" style={{ color: "var(--muted-foreground-faint)" }}>
          ∅ null
        </p>
      ) : raw ? (
        <pre
          className="code text-[12px] whitespace-pre-wrap max-h-64 overflow-auto scrollbar-thin"
          style={{ color: "var(--foreground)" }}
        >
          {pretty}
        </pre>
      ) : (
        <div className="max-h-80 overflow-auto scrollbar-thin">
          <JsonView value={value} />
        </div>
      )}
    </RelatedCard>
  );
}

// parent record card (this row's FK → referenced row), incl. cross-database
function BelongsToCard({
  title,
  target,
  value,
}: {
  title: string;
  target: {
    connection: string;
    schema: string | undefined;
    table: string;
    column: string;
    transform: VfkTransform;
  };
  value: unknown;
}) {
  const { meta: targetMeta } = useTableMeta(target.connection, target.schema, target.table);
  const [editing, setEditing] = useState(false);
  const pkJson = JSON.stringify({ [target.column]: value });
  // only the reference column can carry a transform (e.g. case-insensitive),
  // so this key is a single-entry map — but keyTransforms is shaped to
  // support composite keys if that's ever needed here too.
  const keyTransformsJson = target.transform !== "none" ? JSON.stringify({ [target.column]: target.transform }) : undefined;
  const { data, error } = useQuery<{
    row: Record<string, unknown>;
    fkLabels: Record<string, Record<string, string>>;
  }>({
    queryKey: ["record", target.connection, target.schema, target.table, String(value)],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection: target.connection,
          table: target.table,
          path: "row",
          schema: target.schema,
          params: { pk: pkJson, keyTransforms: keyTransformsJson },
        }),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "not found");
      return body;
    },
    enabled: value != null && !!targetMeta,
  });

  const href = recordHref({
    connection: target.connection,
    schema: target.schema,
    table: target.table,
    params: { pk: pkJson, ...(keyTransformsJson ? { keyTransforms: keyTransformsJson } : {}) },
  });
  return (
    <RelatedCard
      title={title}
      subtitle={[target.connection, target.schema, target.table].filter(Boolean).join(".")}
      menu={[
        ...(data && targetMeta && !targetMeta.isView
          ? [{ label: "✎ Edit record", onClick: () => setEditing(true) }]
          : []),
        { label: "Open record →", href },
        {
          label: "Open table",
          href: tableHref({ connection: target.connection, schema: target.schema, table: target.table }),
        },
      ]}
    >
      {value == null ? (
        <p className="text-[13px]" style={{ color: "var(--muted-foreground-faint)" }}>
          ∅ not linked
        </p>
      ) : error ? (
        <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
          {(error as Error).message}
        </p>
      ) : !data || !targetMeta ? (
        <div className="h-16 rounded animate-pulse" style={{ background: "var(--border)" }} />
      ) : (
        <FieldList meta={targetMeta} row={data.row} fkLabels={data.fkLabels} />
      )}
      {editing && data && targetMeta && (
        <RowEditor meta={targetMeta} row={data.row} onClose={() => setEditing(false)} />
      )}
    </RelatedCard>
  );
}

// child rows card (other table's FK → this row), incl. cross-database
function HasManyCard({
  source,
  fkColumn,
  value,
}: {
  source: { connection: string; schema: string | undefined; table: string };
  fkColumn: string;
  value: unknown;
}) {
  const { meta } = useTableMeta(source.connection, source.schema, source.table);
  const router = useRouter();
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
  const [sort, setSort] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const { data, error } = useQuery<{
    rows: Record<string, unknown>[];
    total: number | null;
    fkLabels: Record<string, Record<string, string>>;
  }>({
    queryKey: ["related", source.connection, source.schema, source.table, fkColumn, String(value)],
    queryFn: async () => {
      const filters = JSON.stringify([{ column: fkColumn, op: "eq", value: String(value) }]);
      const res = await fetch(
        dataApiUrl({
          connection: source.connection,
          table: source.table,
          schema: source.schema,
          params: { page: "0", pageSize: "8", filters },
        }),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");
      return body;
    },
    enabled: value != null && !!meta,
  });

  if (!meta) return null;
  const cols = meta.columns.filter((c) => !c.hidden && c.col.name !== fkColumn);
  return (
    <RelatedCard
      title={meta.label}
      subtitle={`${[source.connection, source.schema, source.table].filter(Boolean).join(".")} · via ${fkColumn}`}
      menu={[
        {
          label: "Open table",
          href: tableHref({ connection: source.connection, schema: source.schema, table: source.table }),
        },
      ]}
    >
      {error ? (
        <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
          {(error as Error).message}
        </p>
      ) : !data ? (
        <div className="h-16 rounded animate-pulse" style={{ background: "var(--border)" }} />
      ) : data.rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--muted-foreground-faint)" }}>
          No related rows.
        </p>
      ) : (
        <>
          <DataGrid
            columns={cols}
            rows={data.rows}
            fkLabels={data.fkLabels}
            sort={sort}
            sortDir={sortDir}
            onToggleSort={(col) => {
              if (sort === col) {
                if (sortDir === "asc") setSortDir("desc");
                else {
                  setSort(undefined);
                  setSortDir("asc");
                }
              } else {
                setSort(col);
                setSortDir("asc");
              }
            }}
            rowClickable={!meta.isView}
            onRowClick={(row) => {
              if (meta.isView) return;
              const pkObj: Record<string, unknown> = {};
              for (const k of meta.table.primaryKey) pkObj[k] = row[k];
              router.push(
                recordHref({
                  connection: source.connection,
                  schema: source.schema,
                  table: source.table,
                  params: { pk: JSON.stringify(pkObj) },
                }),
              );
            }}
            maxHeight="calc(100vh - 400px)"
          />
          {data.total != null && data.total > data.rows.length && (
            <p className="text-[12px] mt-1.5" style={{ color: "var(--muted-foreground-faint)" }}>
              showing {data.rows.length} of {data.total}
            </p>
          )}
        </>
      )}
      {editingRow && <RowEditor meta={meta} row={editingRow} onClose={() => setEditingRow(null)} />}
    </RelatedCard>
  );
}

function RecordView() {
  const params = useParams<{
    connection: string;
    table: string;
  }>();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const schema = useSchemaParam();
  const { meta, catalog, schemaMeta } = useTableMeta(params.connection, schema, params.table);
  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const pk = useMemo(() => {
    try {
      // pk may be a direct param or embedded in the `query` param (as `pk=...`)
      // which is how recordHref encodes it via URLSearchParams({query}).
      const direct = search.get("pk");
      if (direct) return JSON.parse(direct) as Record<string, unknown>;
      const queryStr = search.get("query") ?? "";
      const inner = new URLSearchParams(queryStr).get("pk");
      return inner ? (JSON.parse(inner) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [search]);
  // present when this page was reached via a transformed reference (e.g.
  // BelongsToCard's "Open record →" link on a case-insensitive join) — see
  // getRow's keyTransforms.
  const keyTransforms = useMemo(() => {
    try {
      const direct = search.get("keyTransforms");
      if (direct) return JSON.parse(direct) as Record<string, string>;
      const queryStr = search.get("query") ?? "";
      const inner = new URLSearchParams(queryStr).get("keyTransforms");
      return inner ? (JSON.parse(inner) as Record<string, string>) : undefined;
    } catch {
      return undefined;
    }
  }, [search]);

  const { data, error } = useQuery<{
    row: Record<string, unknown>;
    fkLabels: Record<string, Record<string, string>>;
  }>({
    queryKey: [
      "record",
      params.connection,
      schema,
      params.table,
      JSON.stringify(pk),
      JSON.stringify(keyTransforms ?? {}),
    ],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection: params.connection,
          table: params.table,
          path: "row",
          schema: meta?.schema,
          params: {
            pk: JSON.stringify(pk),
            keyTransforms: keyTransforms ? JSON.stringify(keyTransforms) : undefined,
          },
        }),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "not found");
      return body;
    },
    enabled: !!meta && Object.keys(pk).length > 0,
  });

  // relations to render as cards. `schema` on each entry is already resolved
  // to string|undefined here (undefined when that entry's connection has no
  // real schema) — consumers (HasManyCard etc.) just use it, no engine checks.
  const relations = useMemo(() => {
    if (!catalog || !meta || !schemaMeta)
      return {
        belongsTo: [],
        hasMany: [] as {
          connection: string;
          schema: string | undefined;
          table: string;
          fkColumn: string;
        }[],
        manyToMany: [] as {
          connection: string;
          junctionSchema: string | undefined;
          junctionTable: string;
          selfFkColumn: string;
          otherFkColumn: string;
          otherSchema: string | undefined;
          otherTable: string;
        }[],
      };
    // Introspected FKs/virtual-FKs are matched against the always-resolved
    // schema; what we hand to the cards is the display one (undefined when
    // this engine has none) — same split as buildTableMeta.
    const concreteSchema = meta.resolvedSchema;
    const currentSchema = meta.schema;

    const belongsTo = meta.columns
      .filter((c) => c.ref)
      .map((c) => ({ title: c.label, column: c.col.name, target: c.ref! }));
    const manyToMany: {
      connection: string;
      junctionSchema: string | undefined;
      junctionTable: string;
      selfFkColumn: string;
      otherFkColumn: string;
      otherSchema: string | undefined;
      otherTable: string;
    }[] = [];
    const hasMany: {
      connection: string;
      schema: string | undefined;
      table: string;
      fkColumn: string;
    }[] = [];
    // reverse real FKs — scan tables in the same schema (loaded on demand)
    if (schemaMeta?.tables) {
      for (const t of schemaMeta.tables) {
        for (const fk of t.foreignKeys) {
          if (
            fk.referencedSchema === concreteSchema &&
            fk.referencedTable === params.table &&
            fk.columns.length === 1 &&
            !(t.name === params.table)
          ) {
            hasMany.push({
              connection: params.connection,
              schema: currentSchema,
              table: t.name,
              fkColumn: fk.columns[0],
            });
            // Phase 8.5 — a junction table: `t` has this FK back to us plus
            // another single-column FK to a different table → M2M.
            const otherFk = t.foreignKeys.find(
              (f) =>
                f !== fk &&
                f.columns.length === 1 &&
                !(f.referencedSchema === concreteSchema && f.referencedTable === params.table),
            );
            if (otherFk) {
              manyToMany.push({
                connection: params.connection,
                junctionSchema: currentSchema,
                junctionTable: t.name,
                selfFkColumn: fk.columns[0],
                otherFkColumn: otherFk.columns[0],
                otherSchema: currentSchema,
                otherTable: otherFk.referencedTable,
              });
            }
          }
        }
      }
    }
    // reverse virtual FKs (any connection → this table)
    for (const v of schemaMeta.virtualFks) {
      if (v.toConnection !== params.connection || v.toTable !== params.table) continue;
      // $schema resolves to the record's own schema; else must match literally
      const targetSchemaMatches = v.toSchema === SAME_SCHEMA || v.toSchema === concreteSchema;
      if (!targetSchemaMatches) continue;
      const fromSchema = v.toSchema === SAME_SCHEMA ? concreteSchema : v.fromSchema;
      const fkColumn = vfkDisplayColumn(v);
      // can't enumerate a concrete back-link when the source side is a pattern
      if (!fkColumn || isPattern(fromSchema) || isPattern(v.fromTable)) continue;
      hasMany.push({
        connection: v.fromConnection,
        schema: connectionSupportsSchemas(catalog, v.fromConnection) ? fromSchema : undefined,
        table: v.fromTable,
        fkColumn,
      });
    }
    return { belongsTo, hasMany, manyToMany };
  }, [catalog, meta, schemaMeta, params]);

  if (!catalog || !meta || !schemaMeta)
    return (
      <div className="px-8 py-10 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
        Loading…
      </div>
    );
  if (error)
    return (
      <div className="px-8 py-10 text-[13px]" style={{ color: "var(--destructive)" }}>
        {(error as Error).message}
      </div>
    );

  const row = data?.row;
  const jsonColumns = meta.columns.filter((c) => c.widget === "json" && !c.hidden);
  const pkText = Object.entries(pk)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  // the value other tables' FKs point at (single-column PK case)
  const pkValue = meta.table.primaryKey.length === 1 ? pk[meta.table.primaryKey[0]] : null;

  return (
    <div className="px-8 py-7 max-w-6xl">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href={`/browse/${params.connection}`} />}>{params.connection}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink
              render={<Link href={tableHref({ connection: params.connection, schema: meta.schema, table: params.table })} />}
            >
              {meta.label}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {meta.displayColumn && row ? String(row[meta.displayColumn] ?? pkText) : pkText}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-lg font-semibold">
          {meta.displayColumn && row ? String(row[meta.displayColumn] ?? pkText) : pkText}
        </h1>
        <span className="tag code">{pkText}</span>
        <span className="flex-1" />
        {!meta.isView && (
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              ✎ Edit
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirm("Delete this record?")) return;
                const res = await fetch(
                  dataApiUrl({ connection: params.connection, table: params.table, path: "row", schema: meta.schema }),
                  {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pk }),
                  },
                );
                if (res.ok) {
                  qc.invalidateQueries({
                    queryKey: ["rows", params.connection, schema, params.table],
                  });
                  router.push(tableHref({ connection: params.connection, schema: meta.schema, table: params.table }));
                }
              }}
            >
              Delete
            </Button>
          </>
        )}
      </div>

      {!row ? (
        <div className="grid grid-cols-2 gap-4">
          {/* main details card */}
          <Card className="col-span-2 p-4">
            <div className="h-3.5 w-28 rounded animate-pulse mb-4" style={{ background: "var(--input)" }} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {[55, 40, 70, 35, 60, 45, 65, 50].map((w, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="h-2.5 rounded animate-pulse" style={{ background: "var(--border)", width: "38%" }} />
                  <div
                    className="h-3.5 rounded animate-pulse"
                    style={{
                      background: "var(--input)",
                      width: `${w}%`,
                    }}
                  />
                </div>
              ))}
            </div>
          </Card>
          {/* relation card stubs */}
          {[68, 52].map((w, i) => (
            <Card key={i} className="p-4">
              <div
                className="h-3.5 rounded animate-pulse mb-3"
                style={{ background: "var(--input)", width: `${w}%` }}
              />
              <div className="flex flex-col gap-2">
                {[80, 60, 70].map((fw, fi) => (
                  <div
                    key={fi}
                    className="h-3 rounded animate-pulse"
                    style={{ background: "var(--border)", width: `${fw}%` }}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <RelatedCard
              title="Details"
              subtitle={`${params.connection}.${schema}.${params.table}`}
              menu={
                meta.isView
                  ? []
                  : [
                      {
                        label: "✎ Edit record",
                        onClick: () => setEditing(true),
                      },
                      {
                        label: "⧉ Duplicate",
                        onClick: () => setDuplicating(true),
                      },
                    ]
              }
            >
              <FieldList meta={meta} row={row} fkLabels={data!.fkLabels} />
            </RelatedCard>
          </div>

          {jsonColumns.map((c) => (
            <JsonCard key={c.col.name} meta={meta} row={row} pk={pk} column={c.col.name} />
          ))}

          {relations.belongsTo.map((b) => (
            <BelongsToCard key={b.column} title={b.title} target={b.target} value={row[b.column]} />
          ))}

          {pkValue != null &&
            relations.hasMany.map((h) => (
              <HasManyCard
                key={`${h.connection}.${h.schema}.${h.table}.${h.fkColumn}`}
                source={h}
                fkColumn={h.fkColumn}
                value={pkValue}
              />
            ))}

          {pkValue != null &&
            relations.manyToMany.map((m) => (
              <LinkedRecordsCard
                key={`${m.junctionSchema}.${m.junctionTable}.${m.selfFkColumn}.${m.otherFkColumn}`}
                title={humanize(m.otherTable)}
                target={m}
                selfValue={pkValue}
              />
            ))}

          {Object.keys(pk).length > 0 && (
            <div className="col-span-2">
              <RecordComments
                connectionId={meta.connectionId}
                schema={meta.resolvedSchema}
                table={params.table}
                pk={pk}
              />
            </div>
          )}
        </div>
      )}

      {editing && row && <RowEditor meta={meta} row={row} onClose={() => setEditing(false)} />}
      {duplicating && row && (
        <RowEditor meta={meta} row={null} duplicateFrom={row} onClose={() => setDuplicating(false)} />
      )}
    </div>
  );
}

export default function RecordPage() {
  return (
    <Suspense
      fallback={
        <div className="px-8 py-10 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </div>
      }
    >
      <RecordView />
    </Suspense>
  );
}
