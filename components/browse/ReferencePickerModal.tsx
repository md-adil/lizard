"use client";

// Full-browser reference picker: opens the referenced table (possibly in
// another connection/schema — supports cross-database virtual FKs) as a
// filterable, sortable, paginated grid. Clicking a row selects it.
import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useCatalog, buildTableMeta } from "./useTableMeta";
import { DataGrid } from "./DataGrid";
import { TableSearchBar } from "./TableSearchBar";
import type { FilterSet } from "@/lib/data/filters";

interface ListResponse {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  total: number | null;
  fkLabels: Record<string, Record<string, string>>;
}

export function ReferencePickerModal({
  target,
  title,
  onPick,
  onClose,
}: {
  target: { connection: string; schema: string; table: string; column: string };
  title: string;
  onPick: (value: string, label: string | null) => void;
  onClose: () => void;
}) {
  const { data: catalog } = useCatalog();
  const meta = useMemo(
    () =>
      catalog
        ? buildTableMeta(
            catalog,
            target.connection,
            target.schema,
            target.table,
          )
        : null,
    [catalog, target],
  );

  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterSet, setFilterSet] = useState<FilterSet>({
    combinator: "and",
    conditions: [],
  });
  const [search, setSearch] = useState("");
  const pageSize = 25;

  const { data, isLoading, isFetching } = useQuery<ListResponse>({
    queryKey: [
      "refpick",
      target.connection,
      target.schema,
      target.table,
      page,
      sort,
      sortDir,
      filterSet,
      search,
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(sort ? { sort, sortDir } : {}),
        ...(filterSet.conditions.length
          ? {
              filters: JSON.stringify(filterSet.conditions),
              combinator: filterSet.combinator,
            }
          : {}),
        ...(search ? { search } : {}),
      });
      const res = await fetch(
        `/api/data/${target.connection}/${target.schema}/${target.table}?${qs}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load rows");
      return body;
    },
    placeholderData: keepPreviousData,
    enabled: !!meta,
  });

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

  const select = (row: Record<string, unknown>) => {
    const value = row[target.column];
    if (value == null) return;
    const label = meta?.displayColumn
      ? ((row[meta.displayColumn] as string) ?? null)
      : null;
    onPick(String(value), label != null ? String(label) : null);
    onClose();
  };

  const visibleCols = meta?.columns.filter((c) => !c.hidden) ?? [];

  return (
    <>
      <div
        className="fixed inset-0 z-60"
        style={{ background: "var(--overlay)" }}
        onClick={onClose}
      />
      <div
        className="fixed z-70 inset-x-0 top-[5vh] mx-auto w-260 max-w-[95vw] panel p-5 max-h-[88vh] flex flex-col"
        style={{ background: "var(--bg-panel)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-[15px] font-semibold">Pick {title}</h3>
          <span className="tag code">
            {target.connection} · {target.schema}.{target.table}
          </span>
          <span className="flex-1" />
          <button className="btn btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="mb-3">
          <TableSearchBar
            columns={visibleCols}
            rowEstimate={meta?.table.rowEstimate}
            filterSet={filterSet}
            onFilterChange={(s) => {
              setFilterSet(s);
              setPage(0);
            }}
            search={search}
            onSearchChange={(s) => {
              setSearch(s);
              setPage(0);
            }}
            isLoading={isFetching}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {meta ? (
            <DataGrid
              columns={visibleCols}
              rows={data?.rows ?? []}
              fkLabels={data?.fkLabels ?? {}}
              sort={sort}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              rowClickable
              onRowClick={select}
              maxHeight="calc(88vh - 220px)"
            />
          ) : (
            <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
              Loading…
            </p>
          )}
          {isLoading && (
            <p
              className="px-1 py-2 text-[12px]"
              style={{ color: "var(--text-faint)" }}
            >
              Loading…
            </p>
          )}
        </div>

        <div
          className="flex items-center gap-3 mt-3 text-[13px]"
          style={{ color: "var(--text-dim)" }}
        >
          <button
            className="btn btn-sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </button>
          <span>
            Page {page + 1}
            {data?.total != null && <> · {data.total.toLocaleString()} rows</>}
          </span>
          <button
            className="btn btn-sm"
            disabled={!data?.hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
          <span className="flex-1" />
          <span style={{ color: "var(--text-faint)" }}>
            Click a row to select it
          </span>
        </div>
      </div>
    </>
  );
}

interface ListResponse {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  total: number | null;
  fkLabels: Record<string, Record<string, string>>;
}
