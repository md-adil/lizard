"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useCatalog, buildTableMeta, type TableMeta } from "@/components/browse/useTableMeta";
import { RowEditor } from "@/components/browse/RowEditor";
import { CustomizePanel } from "@/components/browse/CustomizePanel";
import { DataGrid } from "@/components/browse/DataGrid";
import type { Filter } from "@/lib/data/crud";

const OPS: { value: Filter["op"]; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "null", label: "is null" },
  { value: "notnull", label: "not null" },
];

interface ListResponse {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  total: number | null;
  fkLabels: Record<string, Record<string, string>>;
}

export default function TablePage() {
  const params = useParams<{ connection: string; schema: string; table: string }>();
  const router = useRouter();
  const { data: catalog, isLoading: catalogLoading, error: catalogError } = useCatalog();

  const meta: TableMeta | null = useMemo(
    () => (catalog ? buildTableMeta(catalog, params.connection, params.schema, params.table) : null),
    [catalog, params]
  );

  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [draft, setDraft] = useState<Filter>({ column: "", op: "contains", value: "" });
  const [editing, setEditing] = useState<Record<string, unknown> | null | "new">();
  const [customizing, setCustomizing] = useState(false);

  const pageSize = 50;
  const { data, isLoading, error } = useQuery<ListResponse>({
    queryKey: ["rows", params.connection, params.schema, params.table, page, sort, sortDir, filters],
    queryFn: async () => {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(sort ? { sort, sortDir } : {}),
        ...(filters.length ? { filters: JSON.stringify(filters) } : {}),
      });
      const res = await fetch(`/api/data/${params.connection}/${params.schema}/${params.table}?${qs}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load rows");
      return body;
    },
    placeholderData: keepPreviousData,
    enabled: !!meta,
  });

  if (catalogLoading) return <PagePad>Loading catalog…</PagePad>;
  if (catalogError) return <PagePad style={{ color: "var(--red)" }}>Failed to load catalog.</PagePad>;
  if (!meta) return <PagePad>Table {params.schema}.{params.table} not found on “{params.connection}”.</PagePad>;

  const visibleCols = meta.columns.filter((c) => !c.hidden);

  const toggleSort = (col: string) => {
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
    setPage(0);
  };

  return (
    <div className="px-8 py-8">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold">{meta.label}</h1>
            <span className="tag code">
              {params.connection} · {params.schema}.{params.table}
            </span>
            {meta.isView && <span className="tag" style={{ color: "var(--amber)" }}>view · read-only</span>}
          </div>
          {meta.table.comment && (
            <p className="text-[13px] mt-1" style={{ color: "var(--text-dim)" }}>
              {meta.table.comment}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setCustomizing(true)}>⚙ Customize</button>
          {!meta.isView && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>＋ New row</button>
          )}
        </div>
      </div>

      {/* filter bar */}
      <div className="flex items-center gap-2 mt-4 mb-3 flex-wrap">
        {filters.map((f, i) => (
          <span key={i} className="tag" style={{ color: "var(--accent)" }}>
            {f.column} {OPS.find((o) => o.value === f.op)?.label} {f.value}
            <button
              className="ml-1.5"
              onClick={() => {
                setFilters((s) => s.filter((_, j) => j !== i));
                setPage(0);
              }}
            >
              ✕
            </button>
          </span>
        ))}
        <select
          className="input w-36"
          style={{ padding: "3px 8px", fontSize: 12 }}
          value={draft.column}
          onChange={(e) => setDraft((s) => ({ ...s, column: e.target.value }))}
        >
          <option value="">+ filter column…</option>
          {meta.columns.map((c) => (
            <option key={c.col.name} value={c.col.name}>{c.col.name}</option>
          ))}
        </select>
        {draft.column && (
          <>
            <select
              className="input w-28"
              style={{ padding: "3px 8px", fontSize: 12 }}
              value={draft.op}
              onChange={(e) => setDraft((s) => ({ ...s, op: e.target.value as Filter["op"] }))}
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {!["null", "notnull"].includes(draft.op) && (
              <input
                className="input w-40"
                style={{ padding: "3px 8px", fontSize: 12 }}
                placeholder="value"
                value={draft.value ?? ""}
                onChange={(e) => setDraft((s) => ({ ...s, value: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setFilters((s) => [...s, draft]);
                    setDraft({ column: "", op: "contains", value: "" });
                    setPage(0);
                  }
                }}
              />
            )}
            <button
              className="btn btn-sm"
              onClick={() => {
                setFilters((s) => [...s, draft]);
                setDraft({ column: "", op: "contains", value: "" });
                setPage(0);
              }}
            >
              Apply
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="text-[13px] mb-3" style={{ color: "var(--red)" }}>{(error as Error).message}</p>
      )}

      <DataGrid
        columns={visibleCols}
        rows={data?.rows ?? []}
        fkLabels={data?.fkLabels ?? {}}
        sort={sort}
        sortDir={sortDir}
        onToggleSort={toggleSort}
        rowClickable={meta.table.primaryKey.length > 0}
        onRowClick={(row) => {
          if (meta.table.primaryKey.length === 0) return;
          const pkObj: Record<string, unknown> = {};
          for (const k of meta.table.primaryKey) pkObj[k] = row[k];
          router.push(
            `/browse/${params.connection}/${params.schema}/${params.table}/record?pk=${encodeURIComponent(JSON.stringify(pkObj))}`
          );
        }}
      />
      {isLoading && <p className="px-1 py-3 text-[13px]" style={{ color: "var(--text-dim)" }}>Loading…</p>}
      {!isLoading && data?.rows.length === 0 && (
        <p className="px-1 py-6 text-[13px]" style={{ color: "var(--text-dim)" }}>
          No rows{filters.length ? " match the filters" : ""}.
        </p>
      )}

      <div className="flex items-center gap-3 mt-3 text-[13px]" style={{ color: "var(--text-dim)" }}>
        <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
        <span>
          Page {page + 1}
          {data?.total != null && <> · {data.total.toLocaleString()} rows</>}
        </span>
        <button className="btn btn-sm" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>Next →</button>
      </div>

      {editing !== undefined && (
        <RowEditor meta={meta} row={editing === "new" ? null : (editing as Record<string, unknown>)} onClose={() => setEditing(undefined)} />
      )}
      {customizing && catalog && (
        <CustomizePanel meta={meta} catalog={catalog} onClose={() => setCustomizing(false)} />
      )}
    </div>
  );
}

function PagePad({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="px-8 py-10 text-[14px]" style={{ color: "var(--text-dim)", ...style }}>
      {children}
    </div>
  );
}
