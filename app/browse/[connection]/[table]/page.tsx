"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTableMeta } from "@/components/browse/useTableMeta";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { RowEditor } from "@/components/browse/row-editor";
import { DataGrid } from "@/components/browse/data-grid";
import { useColumnVisibility } from "@/components/browse/use-column-visibility";
import { SavedViewsBar } from "@/components/browse/saved-views-bar";
import { TableSearchBar } from "@/components/browse/table-search-bar";
import {
  availableViews,
  VIEW_LABELS,
  kanbanGroupColumns,
  dateColumns,
  selfRefColumn,
  type ViewType,
} from "@/components/browse/view-types";
import { GalleryView, KanbanView, CalendarView, TreeView } from "@/components/browse/table-views";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportCsvDialog } from "@/components/browse/import-csv-dialog";
import { useSchemaParam, recordHref, customizeHref } from "@/components/browse/use-schema-param";
import { dataApiUrl } from "@/components/browse/data-api";
import type { SavedViewConfig } from "@/lib/types";
import type { FilterSet } from "@/lib/data/filters";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useInterval } from "@/hooks/use-interval";
import { Card } from "@/components/ui/card";

interface ListResponse {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  total: number | null;
  fkLabels: Record<string, Record<string, string>>;
}

const EMPTY_ROWS: Record<string, unknown>[] = [];
const EMPTY_FK_LABELS: Record<string, Record<string, string>> = {};

export default function TablePage() {
  const params = useParams<{
    connection: string;
    table: string;
  }>();
  const router = useRouter();
  // schema is a query param now (?schema=) — absent for engines without schemas.
  const schema = useSchemaParam();
  const { meta, isLoading: catalogLoading, error: catalogError } = useTableMeta(params.connection, schema, params.table);

  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterSet, setFilterSet] = useState<FilterSet>({
    combinator: "and",
    conditions: [],
  });
  const [editing, setEditing] = useState<Record<string, unknown> | null | "new">();
  const [search, setSearch] = useState("");
  const [viewType, setViewType] = useState<ViewType>("table");
  const [groupBy, setGroupBy] = useState<string | undefined>();
  const [dateField, setDateField] = useState<string | undefined>();
  // Phase 8.8 — Grafana-style auto-refresh, default off (ms; 0 = off).
  const [refreshMs, setRefreshMs] = useState(0);
  const [columnVisibility, setColumnVisibility] = useColumnVisibility(
    meta?.connectionId,
    meta?.resolvedSchema,
    params.table,
  );
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
  const clearSelection = () => {
    setSelectedRows([]);
    setClearSelectionSignal((n) => n + 1);
  };
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [importing, setImporting] = useState(false);

  const pageSize = 50;
  const { data, isLoading, isFetching, error, refetch } = useQuery<ListResponse>({
    queryKey: ["rows", params.connection, schema, params.table, page, sort, sortDir, filterSet, search],
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
        dataApiUrl({
          connection: params.connection,
          table: params.table,
          schema: meta!.schema,
          params: Object.fromEntries(qs),
        }),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load rows");
      return body;
    },
    placeholderData: keepPreviousData,
    enabled: !!meta,
  });

  // Phase 8.8 — Grafana-style auto-refresh (off by default; no LISTEN/NOTIFY,
  // see PLAN.md §8.8 for why: a trigger-based approach would need DDL on the
  // target DB).
  useInterval(() => refetch(), refreshMs > 0 ? refreshMs : null);

  if (catalogLoading) return <PagePad>Loading catalog…</PagePad>;
  if (catalogError) return <PagePad style={{ color: "var(--destructive)" }}>Failed to load catalog.</PagePad>;
  if (!meta)
    return (
      <PagePad>
        Table {schema}.{params.table} not found on “{params.connection}”.
      </PagePad>
    );

  const visibleCols = meta.columns.filter((c) => !c.hidden);

  // Phase 8.4 — alternate view types this table supports + group/date pickers.
  const views = availableViews(meta);
  const groupCols = kanbanGroupColumns(meta);
  const dateCols = dateColumns(meta);
  const parentField = selfRefColumn(meta);
  const activeGroupBy = groupBy ?? groupCols[0]?.col.name;
  const activeDateField = dateField ?? dateCols[0]?.col.name;

  const openRow = (row: Record<string, unknown>) => {
    if (meta.table.primaryKey.length === 0) return;
    const pkObj: Record<string, unknown> = {};
    for (const k of meta.table.primaryKey) pkObj[k] = row[k];
    router.push(
      recordHref({ connection: params.connection, schema: meta.schema, table: params.table, params: { pk: JSON.stringify(pkObj) } }),
    );
  };

  // Phase 8.2 — bulk delete needs a real, writable primary key to target rows.
  const canBulkDelete = !meta.isView && meta.table.primaryKey.length > 0;
  const bulkDelete = async () => {
    if (
      !window.confirm(
        `Delete ${selectedRows.length} row${selectedRows.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    setBulkDeleting(true);
    try {
      for (const row of selectedRows) {
        const pk: Record<string, unknown> = {};
        for (const k of meta.table.primaryKey) pk[k] = row[k];
        await fetch(dataApiUrl({ connection: params.connection, table: params.table, path: "row", schema: meta.schema }), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pk }),
        });
      }
      clearSelection();
      refetch();
    } finally {
      setBulkDeleting(false);
    }
  };

  // CSV export honors the current filter/sort/search (Phase 8.7). Plain link so
  // the browser handles the download; the session cookie rides along.
  const exportQs = new URLSearchParams({
    ...(sort ? { sort, sortDir } : {}),
    ...(filterSet.conditions.length
      ? {
          filters: JSON.stringify(filterSet.conditions),
          combinator: filterSet.combinator,
        }
      : {}),
    ...(search ? { search } : {}),
  });
  const exportHref = dataApiUrl({
    connection: params.connection,
    table: params.table,
    path: "export",
    schema: meta.schema,
    params: Object.fromEntries(exportQs),
  });

  // saved-views (Phase 8.3): capture / restore the browsing state
  const viewConfig: SavedViewConfig = {
    filterSet,
    sort,
    sortDir,
    search,
    columnVisibility,
    viewType,
    groupBy: activeGroupBy ?? null,
    refreshMs,
  };
  const applyView = (c: SavedViewConfig) => {
    setFilterSet((c.filterSet as FilterSet) ?? { combinator: "and", conditions: [] });
    setSort(c.sort);
    setSortDir(c.sortDir ?? "asc");
    setSearch(c.search ?? "");
    if (c.columnVisibility) setColumnVisibility(c.columnVisibility);
    if (c.viewType && views.includes(c.viewType)) setViewType(c.viewType);
    if (c.groupBy) setGroupBy(c.groupBy);
    setRefreshMs(c.refreshMs ?? 0);
    setPage(0);
  };

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
            <BreadcrumbPage>{meta.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold">{meta.label}</h1>
            {meta.isView && (
              <span className="tag" style={{ color: "var(--warning)" }}>
                view · read-only
              </span>
            )}
          </div>
          {meta.table.comment && (
            <p className="text-[13px] mt-1" style={{ color: "var(--muted-foreground)" }}>
              {meta.table.comment}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <SavedViewsBar
            connectionId={meta.connectionId}
            schema={meta.resolvedSchema}
            table={params.table}
            currentConfig={viewConfig}
            onApply={applyView}
          />
          <Button variant="outline" nativeButton={false} render={<a href={exportHref} download />}>
            ⬇ Export CSV
          </Button>
          {!meta.isView && (
            <Button variant="outline" onClick={() => setImporting(true)}>
              ⬆ Import CSV
            </Button>
          )}
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={customizeHref({ connection: params.connection, schema: meta.schema, table: params.table })} />}
          >
            ⚙ Customize
          </Button>
          {!meta.isView && <Button onClick={() => setEditing("new")}>＋ New row</Button>}
        </div>
      </div>

      {/* search + filter toolbar */}
      <div className="mt-4 mb-3">
        <TableSearchBar
          columns={meta.columns.filter((c) => !c.hidden)}
          rowEstimate={meta.table.rowEstimate}
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
          isLoading={isFetching && !isLoading}
        />
      </div>

      {error && (
        <p className="text-[13px] mb-3" style={{ color: "var(--destructive)" }}>
          {(error as Error).message}
        </p>
      )}

      {/* Phase 8.4 — view-type switcher (table stays the source of truth for
        pagination; alternate views render the currently-loaded page). */}
      <div className="flex items-center gap-3 mb-3">
        {views.length > 1 && (
          <Tabs value={viewType} onValueChange={(v) => setViewType(v as ViewType)}>
            <TabsList variant="line">
              {views.map((v) => (
                <TabsTrigger key={v} value={v}>
                  {VIEW_LABELS[v]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        {viewType === "kanban" && groupCols.length > 1 && (
          <select
            className="input"
            style={{ width: "auto" }}
            value={activeGroupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            {groupCols.map((c) => (
              <option key={c.col.name} value={c.col.name}>
                Group by {c.label}
              </option>
            ))}
          </select>
        )}
        {viewType === "calendar" && dateCols.length > 1 && (
          <select
            className="input"
            style={{ width: "auto" }}
            value={activeDateField}
            onChange={(e) => setDateField(e.target.value)}
          >
            {dateCols.map((c) => (
              <option key={c.col.name} value={c.col.name}>
                By {c.label}
              </option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        {/* Phase 8.8 — auto-refresh, default off */}
        <select
          className="input"
          style={{ width: "auto" }}
          value={refreshMs}
          onChange={(e) => setRefreshMs(Number(e.target.value))}
          title="Auto-refresh"
        >
          <option value={0}>Refresh: off</option>
          <option value={5000}>Refresh: 5s</option>
          <option value={10000}>Refresh: 10s</option>
          <option value={30000}>Refresh: 30s</option>
          <option value={60000}>Refresh: 1m</option>
        </select>
        {isFetching && refreshMs > 0 && (
          <Loader2 className="size-3.5 animate-spin" style={{ color: "var(--primary)" }} />
        )}
      </div>
      {viewType === "table" && canBulkDelete && selectedRows.length > 0 && (
        <div
          className="flex items-center gap-3 mb-2 px-3 py-2 rounded-md"
          style={{ background: "var(--primary-soft)" }}
        >
          <span className="text-[13px]" style={{ color: "var(--primary)" }}>
            {selectedRows.length} selected
          </span>
          <Button variant="destructive" size="sm" disabled={bulkDeleting} onClick={bulkDelete}>
            {bulkDeleting ? "Deleting…" : "🗑 Delete selected"}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {viewType === "table" && (
        <DataGrid
          columns={visibleCols}
          rows={data?.rows ?? EMPTY_ROWS}
          fkLabels={data?.fkLabels ?? EMPTY_FK_LABELS}
          isLoading={isLoading}
          isFetching={isFetching}
          sort={sort}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          rowClickable={meta.table.primaryKey.length > 0}
          onRowClick={openRow}
          onSelectionChange={canBulkDelete ? setSelectedRows : undefined}
          clearSelectionSignal={clearSelectionSignal}
        />
      )}
      {viewType === "gallery" && <GalleryView meta={meta} rows={data?.rows ?? EMPTY_ROWS} onOpen={openRow} />}
      {viewType === "kanban" && activeGroupBy && (
        <KanbanView
          meta={meta}
          rows={data?.rows ?? EMPTY_ROWS}
          fkLabels={data?.fkLabels ?? EMPTY_FK_LABELS}
          groupBy={activeGroupBy}
          onOpen={openRow}
          onChanged={() => refetch()}
        />
      )}
      {viewType === "calendar" && activeDateField && (
        <CalendarView meta={meta} rows={data?.rows ?? EMPTY_ROWS} dateField={activeDateField} onOpen={openRow} />
      )}
      {viewType === "tree" && parentField && (
        <TreeView meta={meta} rows={data?.rows ?? EMPTY_ROWS} parentField={parentField} onOpen={openRow} />
      )}
      {!isLoading && data?.rows.length === 0 && (
        <p className="px-1 py-6 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          No rows{filterSet.conditions.length ? " match the filters" : ""}.
        </p>
      )}

      <div className="flex items-center gap-3 mt-3 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ← Prev
        </Button>
        <span>
          Page {page + 1}
          {data?.total != null && <> · {data.total.toLocaleString()} rows</>}
        </span>
        <Button variant="outline" size="sm" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>
          Next →
        </Button>
      </div>

      {editing !== undefined && (
        <RowEditor
          meta={meta}
          row={editing === "new" ? null : (editing as Record<string, unknown>)}
          onClose={() => setEditing(undefined)}
        />
      )}
      {importing && <ImportCsvDialog meta={meta} onClose={() => setImporting(false)} onImported={() => refetch()} />}
    </div>
  );
}

function PagePad({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="px-8 py-10 text-[14px]" style={{ color: "var(--muted-foreground)", ...style }}>
      {children}
    </div>
  );
}
