"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useCatalog, buildTableMeta, type TableMeta } from "@/components/browse/useTableMeta";
import { RowEditor } from "@/components/browse/RowEditor";
import { CustomizePanel } from "@/components/browse/CustomizePanel";
import { DataGrid } from "@/components/browse/DataGrid";
import { FilterBuilder } from "@/components/browse/FilterBuilder";
import type { FilterSet } from "@/lib/data/filters";

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
  const [filterSet, setFilterSet] = useState<FilterSet>({ combinator: "and", conditions: [] });
  const [editing, setEditing] = useState<Record<string, unknown> | null | "new">();
  const [customizing, setCustomizing] = useState(false);

  const pageSize = 50;
  const { data, isLoading, error } = useQuery<ListResponse>({
    queryKey: ["rows", params.connection, params.schema, params.table, page, sort, sortDir, filterSet],
    queryFn: async () => {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(sort ? { sort, sortDir } : {}),
        ...(filterSet.conditions.length
          ? { filters: JSON.stringify(filterSet.conditions), combinator: filterSet.combinator }
          : {}),
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

      {/* filter — inline, full width below the title so nothing gets clipped */}
      <div className="mt-4 mb-3">
        <FilterBuilder
          columns={meta.columns.filter((c) => !c.hidden)}
          value={filterSet}
          onChange={(s) => {
            setFilterSet(s);
            setPage(0);
          }}
        />
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
          No rows{filterSet.conditions.length ? " match the filters" : ""}.
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
