"use client";

// Full-browser reference picker: opens the referenced table (possibly in
// another connection/schema — supports cross-database virtual FKs) as a
// filterable, sortable, paginated grid. Clicking a row selects it.
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTableMeta } from "./useTableMeta";
import { DataGrid } from "./data-grid";
import { TableSearchBar } from "./table-search-bar";
import type { FilterSet } from "@/lib/data/filters";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  target: { connection: string; schema: string | undefined; table: string; column: string };
  title: string;
  onPick: (value: string, label: string | null) => void;
  onClose: () => void;
}) {
  const { meta } = useTableMeta(target.connection, target.schema, target.table);

  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterSet, setFilterSet] = useState<FilterSet>({
    combinator: "and",
    conditions: [],
  });
  const [search, setSearch] = useState("");
  const pageSize = 25;

  const schemaParam = target.schema ? `schema=${encodeURIComponent(target.schema)}&` : "";

  const { data, isLoading, isFetching } = useQuery<ListResponse>({
    queryKey: ["refpick", target.connection, target.schema, target.table, page, sort, sortDir, filterSet, search],
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
      const res = await fetch(`/api/data/${target.connection}/${target.table}?${schemaParam}${qs}`);
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
    const label = meta?.displayColumn ? ((row[meta.displayColumn] as string) ?? null) : null;
    onPick(String(value), label != null ? String(label) : null);
    onClose();
  };

  const visibleCols = meta?.columns.filter((c) => !c.hidden) ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton className="w-260 max-w-[95vw] sm:max-w-[95vw] max-h-[88vh] flex flex-col p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            Pick {title}
            <span className="tag code">
              {target.connection} · {[target.schema, target.table].filter(Boolean).join(".")}
            </span>
          </DialogTitle>
        </DialogHeader>

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
            <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              Loading…
            </p>
          )}
          {isLoading && (
            <p className="px-1 py-2 text-[12px]" style={{ color: "var(--muted-foreground-faint)" }}>
              Loading…
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 mt-3 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          <Button
            variant="outline"
            size="sm"

            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </Button>
          <span>
            Page {page + 1}
            {data?.total != null && <> · {data.total.toLocaleString()} rows</>}
          </span>
          <Button
            variant="outline"
            size="sm"

            disabled={!data?.hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
          <span className="flex-1" />
          <span style={{ color: "var(--muted-foreground-faint)" }}>Click a row to select it</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ListResponse {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  total: number | null;
  fkLabels: Record<string, Record<string, string>>;
}
