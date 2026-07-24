"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTableMeta } from "@/components/browse/useTableMeta";
import { effectiveKey } from "@/lib/introspect/heuristics";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { RowEditor } from "@/components/browse/row-editor";
import { DataGrid } from "@/components/browse/data-grid";
import { useColumnVisibility } from "@/components/browse/use-column-visibility";
import { useColumnWidths } from "@/components/browse/use-column-widths";
import { useTablePrefs } from "@/components/browse/use-table-prefs";
import { useGridState } from "@/components/browse/use-grid-state";
import { RefetchBar } from "@/components/browse/refetch-bar";
import { ViewTabs } from "@/components/browse/view-tabs";
import { TableSearchBar } from "@/components/browse/table-search-bar";
import {
  availableViews,
  kanbanGroupColumns,
  dateColumns,
  selfRefColumn,
  type ViewType,
} from "@/components/browse/view-types";
import {
  GalleryView,
  CalendarView,
  TreeView,
  currentCalendarCursor,
  type CalendarCursor,
} from "@/components/browse/table-views";
import { KanbanView } from "@/components/browse/kanban-view";
import { ImportCsvDialog } from "@/components/browse/import-csv-dialog";
import { useSchemaParam, recordHref, customizeHref, infoHref } from "@/components/browse/use-schema-param";
import { dataApiUrl } from "@/components/browse/data-api";
import { useGroupedRows } from "@/components/browse/use-grouped-rows";
import { ColumnsSelect } from "@/components/browse/columns-select";
import type { FkLabels, SavedViewConfig } from "@/lib/types";
import type { FilterSet } from "@/lib/data/filters";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { AutoRefreshSelect } from "@/components/ui/auto-refresh-select";
import { Loader2, RefreshCw, Info, Settings2, Download, Upload, Plus } from "lucide-react";
import { useInterval } from "@/hooks/use-interval";
import { Card } from "@/components/ui/card";

interface ListResponse {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  total: number | null;
  fkLabels: FkLabels;
}

const EMPTY_ROWS: Record<string, unknown>[] = [];
const EMPTY_FK_LABELS: FkLabels = {};

export default function TablePage() {
  const params = useParams<{
    connection: string;
    table: string;
  }>();
  const router = useRouter();
  // schema is a query param now (?schema=) — absent for engines without schemas.
  const schema = useSchemaParam();
  const {
    meta,
    isLoading: catalogLoading,
    error: catalogError,
  } = useTableMeta(params.connection, schema, params.table);

  const gridKey = `${params.connection}|${schema ?? ""}|${params.table}`;
  const { page, sort, sortDir, filterSet, search, setPage, setSort, setSortDir, setFilterSet, setSearch } =
    useGridState(gridKey);
  const [editing, setEditing] = useState<Record<string, unknown> | null | "new">();
  const [viewType, setViewType] = useState<ViewType>("table");
  const [groupBy, setGroupBy] = useState<string | undefined>();
  const [dateField, setDateField] = useState<string | undefined>();
  const [calendarCursor, setCalendarCursor] = useState<CalendarCursor>(currentCalendarCursor);
  // Phase 8.8 — Grafana-style auto-refresh, default off (ms; 0 = off).
  const [refreshMs, setRefreshMs] = useState(0);
  const [columnVisibility, setColumnVisibility] = useColumnVisibility(
    meta?.connectionId,
    meta?.resolvedSchema,
    params.table,
  );
  const [columnSizing, setColumnSizing] = useColumnWidths(meta?.connectionId, meta?.resolvedSchema, params.table);
  const [tablePrefs, setTablePref, tablePrefsLoaded] = useTablePrefs(
    meta?.connectionId,
    meta?.resolvedSchema,
    params.table,
  );
  // apply the persisted view type / group-by / date-field once, after they
  // load — a ref (not state) so this never re-fires and clobbers a manual
  // change made afterward. Gated on tablePrefsLoaded, not just `meta`: the
  // prefs fetch is async, so checking only `meta` would fire (and
  // permanently mark itself done) on the render before the real values ever
  // arrive.
  const appliedSavedPrefs = useRef(false);
  useEffect(() => {
    if (appliedSavedPrefs.current || !meta || !tablePrefsLoaded) return;
    const savedViewType = tablePrefs.viewType;
    if (typeof savedViewType === "string" && availableViews(meta).includes(savedViewType as ViewType)) {
      setViewType(savedViewType as ViewType);
    }
    const savedGroupBy = tablePrefs.groupBy;
    if (typeof savedGroupBy === "string" && kanbanGroupColumns(meta).some((c) => c.col.name === savedGroupBy)) {
      setGroupBy(savedGroupBy);
    }
    const savedDateField = tablePrefs.dateField;
    if (typeof savedDateField === "string" && dateColumns(meta).some((c) => c.col.name === savedDateField)) {
      setDateField(savedDateField);
    }
    appliedSavedPrefs.current = true;
  }, [meta, tablePrefsLoaded, tablePrefs.viewType, tablePrefs.groupBy, tablePrefs.dateField]);
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
  const clearSelection = () => {
    setSelectedRows([]);
    setClearSelectionSignal((n) => n + 1);
  };
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  // Portal target so DataGrid's "Columns" button can render in the toolbar
  // row (next to Refresh) instead of its own row above the grid — a callback
  // ref (not useRef) since we need the DOM node to trigger a render once set.
  const [columnsButtonSlot, setColumnsButtonSlot] = useState<HTMLDivElement | null>(null);

  // Needed above the early returns below since hooks can't be conditional —
  // computed defensively (meta may still be undefined on first render).
  const groupCols = meta ? kanbanGroupColumns(meta) : [];
  const dateCols = meta ? dateColumns(meta) : [];
  const activeGroupBy = groupBy ?? groupCols[0]?.col.name;
  const activeDateField = dateField ?? dateCols[0]?.col.name;

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

  const {
    data: groupedData,
    isLoading: groupedLoading,
    isFetching: groupedFetching,
    refetch: refetchGrouped,
  } = useGroupedRows({
    connection: params.connection,
    schema: meta?.schema,
    table: params.table,
    viewType,
    groupBy: activeGroupBy,
    dateField: activeDateField,
    calendarCursor,
    sort,
    sortDir,
    filters: filterSet.conditions,
    combinator: filterSet.combinator,
    search,
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
        Table {schema ? `${schema}.` : ""}
        {params.table} not found on “{params.connection}”.
      </PagePad>
    );

  const visibleCols = meta.columns.filter((c) => !c.hidden && !c.hiddenInGrid);

  // Phase 8.4 — alternate view types this table supports + group/date pickers.
  const views = availableViews(meta);
  const parentField = selfRefColumn(meta);
  // ColumnsSelect keys items by `.name` — adapt ColumnMeta (label lives at
  // `.label`, the real column name at `.col.name`) into that shape so the
  // picker stays searchable once a table has many candidate columns.
  const groupColItems = groupCols.map((c) => ({ ...c, name: c.label }));
  const activeGroupColItem = groupColItems.find((c) => c.col.name === activeGroupBy) ?? null;
  const dateColItems = dateCols.map((c) => ({ ...c, name: c.label }));
  const activeDateColItem = dateColItems.find((c) => c.col.name === activeDateField) ?? null;

  const rowKey = effectiveKey(meta.table);
  const viewHrefFor = (row: Record<string, unknown>) => {
    const pkObj: Record<string, unknown> = {};
    for (const k of rowKey) pkObj[k] = row[k];
    return recordHref({
      connection: params.connection,
      schema: meta.schema,
      table: params.table,
      params: { pk: JSON.stringify(pkObj) },
    });
  };
  const openRow = (row: Record<string, unknown>) => {
    if (rowKey.length === 0) return;
    router.push(viewHrefFor(row));
  };

  // Phase 8.2 — bulk delete needs a real, writable key (primary key or first
  // unique constraint) to target rows.
  const canBulkDelete = !meta.isView && rowKey.length > 0;
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
        for (const k of rowKey) pk[k] = row[k];
        await fetch(
          dataApiUrl({ connection: params.connection, table: params.table, path: "row", schema: meta.schema }),
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pk }),
          },
        );
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
    <div>
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: "Home", link: "/" },
          { label: params.connection, link: `/browse/${params.connection}` },
          { label: meta.label },
        ]}
      />
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
        <div className="flex gap-1">
          <ButtonGroup>
            <Button
              variant="secondary"
              nativeButton={false}
              render={
                <Link href={infoHref({ connection: params.connection, schema: meta.schema, table: params.table })} />
              }
            >
              <Info className="size-3.5" /> Info
            </Button>
            <Button
              variant="secondary"
              nativeButton={false}
              render={
                <Link
                  href={customizeHref({ connection: params.connection, schema: meta.schema, table: params.table })}
                />
              }
            >
              <Settings2 className="size-3.5" /> Customize
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button variant="secondary" nativeButton={false} render={<a href={exportHref} download />}>
              <Download className="size-3.5" /> Export CSV
            </Button>
            {!meta.isView && (
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <Upload className="size-3.5" /> Import CSV
              </Button>
            )}
          </ButtonGroup>
          {!meta.isView && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-3.5" /> New row
            </Button>
          )}
        </div>
      </div>

      {/* search + filter toolbar */}
      <div className="mt-4 mb-3">
        <TableSearchBar
          columns={meta.columns.filter((c) => !c.hidden)}
          target={{ connection: params.connection, schema: meta.schema, table: params.table }}
          indexedColumns={meta.table.indexedColumns}
          displayColumn={meta.displayColumn}
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
        pagination; alternate views render the currently-loaded page). Saved
        views (named filter/sort/column bundles) live in the same tab row —
        see ViewTabs — rather than a separate "▤ Views" dropdown. */}
      <div className="flex items-center gap-1 mb-3">
        <ViewTabs
          connectionId={meta.connectionId}
          connectionName={params.connection}
          schema={meta.resolvedSchema}
          table={params.table}
          builtInTypes={views}
          viewType={viewType}
          onSelectBuiltIn={(v) => {
            setViewType(v);
            setTablePref("viewType", v);
          }}
          currentConfig={viewConfig}
          onApplySavedView={applyView}
        />
        {viewType === "kanban" && groupCols.length > 1 && (
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            Group by
            <ColumnsSelect
              items={groupColItems}
              value={activeGroupColItem}
              onChange={(c) => {
                if (!c) return;
                setGroupBy(c.col.name);
                setTablePref("groupBy", c.col.name);
              }}
              placeholder="Select column…"
              className="w-40"
            />
          </div>
        )}
        {viewType === "calendar" && dateCols.length > 1 && (
          <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            By
            <ColumnsSelect
              items={dateColItems}
              value={activeDateColItem}
              onChange={(c) => {
                if (!c) return;
                setDateField(c.col.name);
                setTablePref("dateField", c.col.name);
              }}
              placeholder="Select column…"
              className="w-40"
            />
          </div>
        )}
        <span className="flex-1" />
        {viewType === "table" && <div ref={setColumnsButtonSlot} />}
        <AutoRefreshSelect value={refreshMs} onChange={setRefreshMs} />
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Refresh"
          onClick={() => (viewType === "kanban" || viewType === "calendar" ? refetchGrouped() : refetch())}
        >
          <RefreshCw
            className={`size-3.5 ${(viewType === "kanban" || viewType === "calendar" ? groupedFetching : isFetching) ? "animate-spin" : ""}`}
          />
        </Button>
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
          columnSizing={columnSizing}
          onColumnSizingChange={setColumnSizing}
          viewHref={rowKey.length > 0 ? viewHrefFor : undefined}
          onEdit={rowKey.length > 0 && !meta.isView ? (row) => setEditing(row) : undefined}
          onSelectionChange={canBulkDelete ? setSelectedRows : undefined}
          clearSelectionSignal={clearSelectionSignal}
          columnsButtonContainer={columnsButtonSlot}
        />
      )}
      {viewType === "gallery" && (
        <div className="relative">
          <RefetchBar isFetching={isFetching} isLoading={isLoading} />
          <GalleryView meta={meta} rows={data?.rows ?? EMPTY_ROWS} onOpen={openRow} />
        </div>
      )}
      {viewType === "kanban" && activeGroupBy && (
        <div className="relative">
          {/* Kanban is driven by the grouped fetch (use-grouped-rows.ts), not
            the table's flat page — see KanbanView's groupCounts prop. */}
          <RefetchBar isFetching={groupedFetching} isLoading={groupedLoading} />
          <KanbanView
            meta={meta}
            rows={groupedData?.rows ?? EMPTY_ROWS}
            fkLabels={groupedData?.fkLabels ?? EMPTY_FK_LABELS}
            groupBy={activeGroupBy}
            groupCounts={groupedData?.groupCounts}
            onOpen={openRow}
            onChanged={() => refetchGrouped()}
          />
        </div>
      )}
      {viewType === "calendar" && activeDateField && (
        <div className="relative">
          {/* Calendar is driven by the grouped fetch (use-grouped-rows.ts),
            scoped server-side to the visible month and per-day, not the
            table's flat page. */}
          <RefetchBar isFetching={groupedFetching} isLoading={groupedLoading} />
          <CalendarView
            meta={meta}
            rows={groupedData?.rows ?? EMPTY_ROWS}
            dateField={activeDateField}
            groupCounts={groupedData?.groupCounts}
            cursor={calendarCursor}
            onCursorChange={setCalendarCursor}
            onOpen={openRow}
          />
        </div>
      )}
      {viewType === "tree" && parentField && (
        <div className="relative">
          <RefetchBar isFetching={isFetching} isLoading={isLoading} />
          <TreeView meta={meta} rows={data?.rows ?? EMPTY_ROWS} parentField={parentField} onOpen={openRow} />
        </div>
      )}
      {(() => {
        const grouped = viewType === "kanban" || viewType === "calendar";
        const empty = grouped
          ? !groupedLoading && groupedData?.rows.length === 0
          : !isLoading && data?.rows.length === 0;
        return (
          empty && (
            <p className="px-1 py-6 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              No rows{filterSet.conditions.length ? " match the filters" : ""}.
            </p>
          )
        );
      })()}

      {/* Kanban/Calendar aren't paginated — they show every group's top-N in
        one grouped fetch (use-grouped-rows.ts), so a page control tied to the
        table's flat query wouldn't do anything there. */}
      {viewType !== "kanban" && viewType !== "calendar" && (
        <div className="flex items-center gap-3 mt-3 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </Button>
          <span>
            Page {page + 1}
            {data?.total != null && <> · {data.total.toLocaleString()} rows</>}
          </span>
          <Button variant="secondary" size="sm" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>
            Next →
          </Button>
        </div>
      )}

      {editing !== undefined && (
        <RowEditor
          meta={meta}
          row={editing === "new" ? null : (editing as Record<string, unknown>)}
          refetchOnOpen={editing !== "new"}
          onClose={() => setEditing(undefined)}
        />
      )}
      {importing && <ImportCsvDialog meta={meta} onClose={() => setImporting(false)} onImported={() => refetch()} />}
    </div>
  );
}

function PagePad({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="text-[14px]" style={{ color: "var(--muted-foreground)", ...style }}>
      {children}
    </div>
  );
}
