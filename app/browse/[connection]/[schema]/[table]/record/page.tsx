"use client";

// Record details page: the row itself, each JSON column, and every related
// table (parents via FKs/virtual FKs, children via reverse FKs — including
// cross-database relations) rendered as dedicated cards with their own menus.
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCatalog,
  buildTableMeta,
  formatCell,
  type TableMeta,
  type CatalogResponse,
} from "@/components/browse/useTableMeta";
import type { VfkTransform } from "@/lib/types";
import { RowEditor } from "@/components/browse/row-editor";
import { JsonView } from "@/components/browse/json-view";
import { humanize } from "@/lib/introspect/heuristics";
import {
  SAME_SCHEMA,
  isPattern,
  vfkDisplayColumn,
} from "@/lib/introspect/virtual-fk";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

function Card({
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
    <div className="panel p-4 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[13.5px] font-semibold truncate">{title}</span>
        {subtitle && (
          <span className="tag code" style={{ fontSize: 10 }}>
            {subtitle}
          </span>
        )}
        <span className="flex-1" />
        <Button variant="outline" size="sm"
         
          title="Enlarge"
          onClick={() => setExpanded(true)}
        >
          ⤢
        </Button>
        {menu && menu.length > 0 && (
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setOpen((s) => !s)}>
              ⋯
            </Button>
            {open && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setOpen(false)}
                />
                <div
                  className="absolute right-0 z-20 mt-1 w-44 rounded-md border py-1"
                  style={{
                    background: "var(--bg-raised)",
                    borderColor: "var(--border-strong)",
                  }}
                >
                  {menu.map((m) =>
                    m.href ? (
                      <Link
                        key={m.label}
                        href={m.href}
                        className="block px-3 py-1.5 text-[12.5px] hoverable"
                        style={{
                          color: m.danger ? "var(--red)" : "var(--text)",
                        }}
                        onClick={() => setOpen(false)}
                      >
                        {m.label}
                      </Link>
                    ) : (
                      <Button variant="ghost" className="block w-full text-left px-3 py-1.5 text-[12.5px] hoverable"
                        key={m.label}
                       
                        style={{
                          color: m.danger ? "var(--red)" : "var(--text)",
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
            background: "var(--bg-panel)",
            width: "min(90vw, 1100px)",
            height: "min(60vh, 640px)",
            minWidth: 360,
            minHeight: 200,
            maxWidth: "95vw",
            maxHeight: "90vh",
          }}
        >
          <div className="flex items-center gap-2 mb-4 pr-6">
            <DialogTitle className="text-[16px] font-semibold">
              {title}
            </DialogTitle>
            {subtitle && (
              <span className="tag code" style={{ fontSize: 10 }}>
                {subtitle}
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin pr-1 text-[13.5px]">
            {children}
          </div>
        </DialogContent>
      </Dialog>
    </div>
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
  const cols = meta.columns.filter(
    (c) => !c.hidden && !["json", "jsonb"].includes(c.col.udtName),
  );
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
      {cols.map((cm) => {
        const v = row[cm.col.name];
        const label =
          cm.ref && v != null ? fkLabels[cm.col.name]?.[String(v)] : undefined;
        const f = formatCell(v);
        return (
          <div key={cm.col.name} className="min-w-0">
            <div
              className="text-[11px] font-medium uppercase tracking-wide"
              style={{ color: "var(--text-faint)" }}
            >
              {cm.label}
            </div>
            <div
              className="text-[13px] truncate"
              style={{ color: f.muted ? "var(--text-faint)" : "var(--text)" }}
              title={f.text}
            >
              {label ? (
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
  const value = row[column];
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
        `/api/data/${meta.connection}/${meta.schema}/${meta.table.name}/row`,
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
    <Card
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
          <textarea
            className="input code w-full"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {err && (
            <p className="text-[12px] mt-1" style={{ color: "var(--red)" }}>
              {err}
            </p>
          )}
          <Button size="sm" className="mt-2"
           
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save JSON"}
          </Button>
        </>
      ) : value == null ? (
        <p className="text-[13px]" style={{ color: "var(--text-faint)" }}>
          ∅ null
        </p>
      ) : raw ? (
        <pre
          className="code text-[12px] whitespace-pre-wrap max-h-64 overflow-auto scrollbar-thin"
          style={{ color: "var(--text)" }}
        >
          {pretty}
        </pre>
      ) : (
        <div className="max-h-80 overflow-auto scrollbar-thin">
          <JsonView value={value} />
        </div>
      )}
    </Card>
  );
}

// parent record card (this row's FK → referenced row), incl. cross-database
function BelongsToCard({
  catalog,
  title,
  target,
  value,
}: {
  catalog: CatalogResponse;
  title: string;
  target: {
    connection: string;
    schema: string;
    table: string;
    column: string;
    transform: VfkTransform;
  };
  value: unknown;
}) {
  const targetMeta = useMemo(
    () =>
      buildTableMeta(catalog, target.connection, target.schema, target.table),
    [catalog, target],
  );
  const [editing, setEditing] = useState(false);
  const pkParam = encodeURIComponent(
    JSON.stringify({ [target.column]: value }),
  );
  // only the reference column can carry a transform (e.g. case-insensitive),
  // so this key is a single-entry map — but keyTransforms is shaped to
  // support composite keys if that's ever needed here too.
  const keyTransformsParam =
    target.transform !== "none"
      ? `&keyTransforms=${encodeURIComponent(JSON.stringify({ [target.column]: target.transform }))}`
      : "";
  const { data, error } = useQuery<{
    row: Record<string, unknown>;
    fkLabels: Record<string, Record<string, string>>;
  }>({
    queryKey: [
      "record",
      target.connection,
      target.schema,
      target.table,
      String(value),
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/data/${target.connection}/${target.schema}/${target.table}/row?pk=${pkParam}${keyTransformsParam}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "not found");
      return body;
    },
    enabled: value != null && !!targetMeta,
  });

  const recordHref = `/browse/${target.connection}/${target.schema}/${target.table}/record?pk=${pkParam}${keyTransformsParam}`;
  return (
    <Card
      title={title}
      subtitle={`${target.connection}.${target.schema}.${target.table}`}
      menu={[
        ...(data && targetMeta && !targetMeta.isView
          ? [{ label: "✎ Edit record", onClick: () => setEditing(true) }]
          : []),
        { label: "Open record →", href: recordHref },
        {
          label: "Open table",
          href: `/browse/${target.connection}/${target.schema}/${target.table}`,
        },
      ]}
    >
      {value == null ? (
        <p className="text-[13px]" style={{ color: "var(--text-faint)" }}>
          ∅ not linked
        </p>
      ) : error ? (
        <p className="text-[13px]" style={{ color: "var(--red)" }}>
          {(error as Error).message}
        </p>
      ) : !data || !targetMeta ? (
        <div
          className="h-16 rounded animate-pulse"
          style={{ background: "var(--border)" }}
        />
      ) : (
        <FieldList meta={targetMeta} row={data.row} fkLabels={data.fkLabels} />
      )}
      {editing && data && targetMeta && (
        <RowEditor
          meta={targetMeta}
          row={data.row}
          onClose={() => setEditing(false)}
        />
      )}
    </Card>
  );
}

// child rows card (other table's FK → this row), incl. cross-database
function HasManyCard({
  catalog,
  source,
  fkColumn,
  value,
}: {
  catalog: CatalogResponse;
  source: { connection: string; schema: string; table: string };
  fkColumn: string;
  value: unknown;
}) {
  const meta = useMemo(
    () =>
      buildTableMeta(catalog, source.connection, source.schema, source.table),
    [catalog, source],
  );
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(
    null,
  );
  const { data, error } = useQuery<{
    rows: Record<string, unknown>[];
    total: number | null;
    fkLabels: Record<string, Record<string, string>>;
  }>({
    queryKey: [
      "related",
      source.connection,
      source.schema,
      source.table,
      fkColumn,
      String(value),
    ],
    queryFn: async () => {
      const filters = JSON.stringify([
        { column: fkColumn, op: "eq", value: String(value) },
      ]);
      const res = await fetch(
        `/api/data/${source.connection}/${source.schema}/${source.table}?page=0&pageSize=8&filters=${encodeURIComponent(filters)}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");
      return body;
    },
    enabled: value != null && !!meta,
  });

  if (!meta) return null;
  const cols = meta.columns
    .filter((c) => !c.hidden && c.col.name !== fkColumn)
    .slice(0, 4);
  return (
    <Card
      title={meta.label}
      subtitle={`${source.connection}.${source.schema}.${source.table} · via ${fkColumn}`}
      menu={[
        {
          label: "Open table",
          href: `/browse/${source.connection}/${source.schema}/${source.table}`,
        },
      ]}
    >
      {error ? (
        <p className="text-[13px]" style={{ color: "var(--red)" }}>
          {(error as Error).message}
        </p>
      ) : !data ? (
        <div
          className="h-16 rounded animate-pulse"
          style={{ background: "var(--border)" }}
        />
      ) : data.rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--text-faint)" }}>
          No related rows.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="grid">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.col.name}>{c.label}</th>
                  ))}
                  {!meta.isView && <th style={{ width: 36 }} />}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const pkObj: Record<string, unknown> = {};
                  for (const k of meta.table.primaryKey) pkObj[k] = r[k];
                  const href = `/browse/${source.connection}/${source.schema}/${source.table}/record?pk=${encodeURIComponent(JSON.stringify(pkObj))}`;
                  return (
                    <tr
                      key={i}
                      className="cursor-pointer"
                      onClick={() => (window.location.href = href)}
                    >
                      {cols.map((c) => {
                        const f = formatCell(r[c.col.name]);
                        const lbl =
                          c.ref && r[c.col.name] != null
                            ? data.fkLabels[c.col.name]?.[String(r[c.col.name])]
                            : undefined;
                        return (
                          <td
                            key={c.col.name}
                            style={{
                              color: f.muted ? "var(--text-faint)" : undefined,
                            }}
                          >
                            {lbl ?? f.text}
                          </td>
                        );
                      })}
                      {!meta.isView && (
                        <td>
                          <Button variant="outline" size="sm"
                           
                            style={{ padding: "0 6px", fontSize: 11 }}
                            title="Edit this record here"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingRow(r);
                            }}
                          >
                            ✎
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.total != null && data.total > data.rows.length && (
            <p
              className="text-[12px] mt-1.5"
              style={{ color: "var(--text-faint)" }}
            >
              showing {data.rows.length} of {data.total}
            </p>
          )}
        </>
      )}
      {editingRow && (
        <RowEditor
          meta={meta}
          row={editingRow}
          onClose={() => setEditingRow(null)}
        />
      )}
    </Card>
  );
}

function RecordView() {
  const params = useParams<{
    connection: string;
    schema: string;
    table: string;
  }>();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: catalog } = useCatalog();
  const [editing, setEditing] = useState(false);

  const pk = useMemo(() => {
    try {
      return JSON.parse(search.get("pk") ?? "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [search]);
  // present when this page was reached via a transformed reference (e.g.
  // BelongsToCard's "Open record →" link on a case-insensitive join) — see
  // getRow's keyTransforms.
  const keyTransforms = useMemo(() => {
    try {
      const raw = search.get("keyTransforms");
      return raw ? (JSON.parse(raw) as Record<string, string>) : undefined;
    } catch {
      return undefined;
    }
  }, [search]);

  const meta = useMemo(
    () =>
      catalog
        ? buildTableMeta(
            catalog,
            params.connection,
            params.schema,
            params.table,
          )
        : null,
    [catalog, params],
  );

  const { data, error } = useQuery<{
    row: Record<string, unknown>;
    fkLabels: Record<string, Record<string, string>>;
  }>({
    queryKey: [
      "record",
      params.connection,
      params.schema,
      params.table,
      JSON.stringify(pk),
      JSON.stringify(keyTransforms ?? {}),
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({ pk: JSON.stringify(pk) });
      if (keyTransforms) qs.set("keyTransforms", JSON.stringify(keyTransforms));
      const res = await fetch(
        `/api/data/${params.connection}/${params.schema}/${params.table}/row?${qs}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "not found");
      return body;
    },
    enabled: !!meta && Object.keys(pk).length > 0,
  });

  // relations to render as cards
  const relations = useMemo(() => {
    if (!catalog || !meta)
      return {
        belongsTo: [],
        hasMany: [] as {
          connection: string;
          schema: string;
          table: string;
          fkColumn: string;
        }[],
      };
    const belongsTo = meta.columns
      .filter((c) => c.ref)
      .map((c) => ({ title: c.label, column: c.col.name, target: c.ref! }));
    const hasMany: {
      connection: string;
      schema: string;
      table: string;
      fkColumn: string;
    }[] = [];
    // reverse real FKs (same connection)
    for (const conn of catalog.connections) {
      if (conn.connectionName !== params.connection) continue;
      for (const s of conn.schemas) {
        for (const t of s.tables) {
          for (const fk of t.foreignKeys) {
            if (
              fk.referencedSchema === params.schema &&
              fk.referencedTable === params.table &&
              fk.columns.length === 1 &&
              !(t.name === params.table && s.name === params.schema)
            ) {
              hasMany.push({
                connection: conn.connectionName,
                schema: s.name,
                table: t.name,
                fkColumn: fk.columns[0],
              });
            }
          }
        }
      }
    }
    // reverse virtual FKs (any connection → this table)
    for (const v of catalog.virtualFks) {
      if (v.toConnection !== params.connection || v.toTable !== params.table)
        continue;
      // $schema resolves to the record's own schema; else must match literally
      const targetSchemaMatches =
        v.toSchema === SAME_SCHEMA || v.toSchema === params.schema;
      if (!targetSchemaMatches) continue;
      const fromSchema =
        v.toSchema === SAME_SCHEMA ? params.schema : v.fromSchema;
      const fkColumn = vfkDisplayColumn(v);
      // can't enumerate a concrete back-link when the source side is a pattern
      if (!fkColumn || isPattern(fromSchema) || isPattern(v.fromTable)) continue;
      hasMany.push({
        connection: v.fromConnection,
        schema: fromSchema,
        table: v.fromTable,
        fkColumn,
      });
    }
    return { belongsTo, hasMany };
  }, [catalog, meta, params]);

  if (!catalog || !meta)
    return (
      <div
        className="px-8 py-10 text-[13px]"
        style={{ color: "var(--text-dim)" }}
      >
        Loading…
      </div>
    );
  if (error)
    return (
      <div className="px-8 py-10 text-[13px]" style={{ color: "var(--red)" }}>
        {(error as Error).message}
      </div>
    );

  const row = data?.row;
  const jsonColumns = meta.columns.filter(
    (c) => ["json", "jsonb"].includes(c.col.udtName) && !c.hidden,
  );
  const pkText = Object.entries(pk)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  // the value other tables' FKs point at (single-column PK case)
  const pkValue =
    meta.table.primaryKey.length === 1 ? pk[meta.table.primaryKey[0]] : null;

  return (
    <div className="px-8 py-7 max-w-6xl">
      <div className="flex items-center gap-3 mb-5">
        <Link
          href={`/browse/${params.connection}/${params.schema}/${params.table}`}
          className="btn btn-sm"
        >
          ← {meta.label}
        </Link>
        <h1 className="text-lg font-semibold">
          {meta.displayColumn && row
            ? String(row[meta.displayColumn] ?? pkText)
            : pkText}
        </h1>
        <span className="tag code">{pkText}</span>
        <span className="flex-1" />
        {!meta.isView && (
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              ✎ Edit
            </Button>
            <Button variant="destructive"
             
              onClick={async () => {
                if (!confirm("Delete this record?")) return;
                const res = await fetch(
                  `/api/data/${params.connection}/${params.schema}/${params.table}/row`,
                  {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pk }),
                  },
                );
                if (res.ok) {
                  qc.invalidateQueries({
                    queryKey: [
                      "rows",
                      params.connection,
                      params.schema,
                      params.table,
                    ],
                  });
                  router.push(
                    `/browse/${params.connection}/${params.schema}/${params.table}`,
                  );
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
          <div className="col-span-2 panel p-4">
            <div
              className="h-3.5 w-28 rounded animate-pulse mb-4"
              style={{ background: "var(--border-strong)" }}
            />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {[55, 40, 70, 35, 60, 45, 65, 50].map((w, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div
                    className="h-2.5 rounded animate-pulse"
                    style={{ background: "var(--border)", width: "38%" }}
                  />
                  <div
                    className="h-3.5 rounded animate-pulse"
                    style={{
                      background: "var(--border-strong)",
                      width: `${w}%`,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          {/* relation card stubs */}
          {[68, 52].map((w, i) => (
            <div key={i} className="panel p-4">
              <div
                className="h-3.5 rounded animate-pulse mb-3"
                style={{ background: "var(--border-strong)", width: `${w}%` }}
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
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Card
              title="Details"
              subtitle={`${params.connection}.${params.schema}.${params.table}`}
              menu={
                meta.isView
                  ? []
                  : [
                      {
                        label: "✎ Edit record",
                        onClick: () => setEditing(true),
                      },
                    ]
              }
            >
              <FieldList meta={meta} row={row} fkLabels={data!.fkLabels} />
            </Card>
          </div>

          {jsonColumns.map((c) => (
            <JsonCard
              key={c.col.name}
              meta={meta}
              row={row}
              pk={pk}
              column={c.col.name}
            />
          ))}

          {relations.belongsTo.map((b) => (
            <BelongsToCard
              key={b.column}
              catalog={catalog}
              title={b.title}
              target={b.target}
              value={row[b.column]}
            />
          ))}

          {pkValue != null &&
            relations.hasMany.map((h) => (
              <HasManyCard
                key={`${h.connection}.${h.schema}.${h.table}.${h.fkColumn}`}
                catalog={catalog}
                source={h}
                fkColumn={h.fkColumn}
                value={pkValue}
              />
            ))}
        </div>
      )}

      {editing && row && (
        <RowEditor meta={meta} row={row} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

export default function RecordPage() {
  return (
    <Suspense
      fallback={
        <div
          className="px-8 py-10 text-[13px]"
          style={{ color: "var(--text-dim)" }}
        >
          Loading…
        </div>
      }
    >
      <RecordView />
    </Suspense>
  );
}
