"use client";

// Data grid built on @tanstack/react-table + shadcn's Table primitives,
// following shadcn's own data-table doc pattern (Table > TableHeader/
// TableBody, flexRender per header/cell). table-layout:fixed + an explicit
// width on every th/td (driven by TanStack column sizing held in React
// state) keeps header/body aligned and drives live column-resize. Sorting
// stays server-side: header clicks call back to the parent to refetch.
import { useEffect, useMemo, useState } from "react";
import type { FkLabels } from "@/lib/types";
import { RefetchBar } from "./refetch-bar";
import { fkLabelFor } from "@/lib/data/fk-labels";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
  type ColumnSizingState,
  type VisibilityState,
  type RowSelectionState,
  type Updater,
} from "@tanstack/react-table";
import { Columns3 } from "lucide-react";
import type { ColumnMeta } from "./useTableMeta";
import { formatCell } from "./useTableMeta";
import { RedactedValue } from "./redacted-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useColumnSearch } from "./use-column-search";

type Row = Record<string, unknown>;

// Below this many toggleable columns, scanning the list by eye is easier
// than typing — the search box only earns its keep past that.
const COLUMN_SEARCH_THRESHOLD = 10;

interface Props {
  columns: ColumnMeta[];
  rows: Row[];
  fkLabels: FkLabels;
  sort?: string;
  sortDir: "asc" | "desc";
  onToggleSort: (column: string) => void;
  onRowClick?: (row: Row) => void;
  rowClickable?: boolean;
  maxHeight?: string;
  isLoading?: boolean;
  isFetching?: boolean;
  // Controlled column-visibility ("Columns ▾" toggle). Omit to fall back to
  // local, unpersisted state (e.g. the reference picker modal, which doesn't
  // need this to survive reloads).
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (updater: Updater<VisibilityState>) => void;
  // Phase 8.2 — row-selection checkboxes for bulk actions. Omit to hide the
  // selection column entirely (e.g. the reference picker modal).
  onSelectionChange?: (rows: Row[]) => void;
  // Bump this (e.g. a counter) to force-clear the current row selection —
  // e.g. after "Clear" or a bulk delete completes, independent of `rows`
  // changing (rowSelection already resets whenever `rows` itself changes).
  clearSelectionSignal?: number;
}

const helper = createColumnHelper<Row>();

// deterministic skeleton cell widths to avoid re-render flicker
const SK_WIDTHS = [72, 55, 88, 64, 91, 48, 76, 60, 83, 44];

// initial width heuristic: short types narrow, references/text wider
function defaultWidth(cm: ColumnMeta): number {
  if (["bool", "int2", "int4", "int8", "date"].includes(cm.col.udtName)) return 120;
  if (cm.widget === "reference") return 230;
  if (cm.widget === "datetime") return 180;
  if (cm.widget === "textarea" || cm.widget === "json") return 300;
  return 170;
}

export function DataGrid({
  columns,
  rows,
  fkLabels,
  sort,
  sortDir,
  onToggleSort,
  onRowClick,
  rowClickable,
  maxHeight = "calc(100vh - 240px)",
  isLoading = false,
  isFetching = false,
  columnVisibility: controlledVisibility,
  onColumnVisibilityChange,
  onSelectionChange,
  clearSelectionSignal,
}: Props) {
  // holding sizing in React state guarantees a re-render on every resize tick
  const [colSizing, setColSizing] = useState<ColumnSizingState>({});
  const [localVisibility, setLocalVisibility] = useState<VisibilityState>({});
  const columnVisibility = controlledVisibility ?? localVisibility;
  const setColumnVisibility = onColumnVisibilityChange ?? setLocalVisibility;
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // row identity is by index, which only stays valid for the currently-loaded
  // page — drop any stale selection whenever the page's rows change.
  useEffect(() => setRowSelection({}), [rows]);
  useEffect(() => setRowSelection({}), [clearSelectionSignal]);
  // "Columns ▾" search — a wide table can have dozens of columns, so filter
  // the toggle list instead of making the user scroll for one. Cleared
  // whenever the menu closes so it doesn't carry over stale to the next open.
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [columnSearch, setColumnSearch] = useState("");

  const colDefs = useMemo<ColumnDef<Row>[]>(
    () => [
      ...(onSelectionChange
        ? [
            helper.display({
              id: "__select",
              size: 32,
              minSize: 32,
              maxSize: 32,
              header: ({ table }) => (
                <Checkbox
                  checked={table.getIsAllRowsSelected()}
                  indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
                  onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
                  aria-label="Select all rows"
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(v) => row.toggleSelected(!!v)}
                  aria-label="Select row"
                />
              ),
            }) as ColumnDef<Row>,
          ]
        : []),
      ...columns.map((cm) =>
        helper.accessor((r) => r[cm.col.name], {
          id: cm.col.name,
          header: cm.label,
          size: defaultWidth(cm),
          minSize: 64,
          maxSize: 800,
          cell: (info) => {
            const v = info.getValue<unknown>();
            if (cm.redacted) {
              return <RedactedValue value={v} />;
            }
            const label =
              cm.ref && v != null
                ? fkLabelFor(fkLabels, cm.col.name, info.row.original as Record<string, unknown>)
                : undefined;
            if (label) {
              return (
                <>
                  {label}{" "}
                  <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">{String(v)}</span>
                </>
              );
            }
            const f = formatCell(v, cm.widget, cm.optionLabels);
            return <span className={f.muted ? "text-muted-foreground" : undefined}>{f.icon ?? f.text}</span>;
          },
        }),
      ),
    ],
    [columns, fkLabels, onSelectionChange],
  );

  const table = useReactTable({
    data: rows,
    columns: colDefs,
    state: { columnSizing: colSizing, columnVisibility, rowSelection },
    onColumnSizingChange: setColSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: !!onSelectionChange,
  });

  // notify the parent with actual row objects whenever selection changes
  useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange(table.getSelectedRowModel().rows.map((r) => r.original));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  const leafColumns = table.getVisibleLeafColumns();
  const totalWidth = table.getTotalSize();
  const allLeafColumns = table.getAllLeafColumns();
  const toggleableColumns = useMemo(() => allLeafColumns.filter((c) => c.id !== "__select"), [allLeafColumns]);
  const searchedColumns = useColumnSearch(toggleableColumns, columns, columnSearch);

  return (
    <div>
      <div className="flex justify-end mb-2">
        <DropdownMenu
          open={columnsMenuOpen}
          onOpenChange={(open) => {
            setColumnsMenuOpen(open);
            if (!open) setColumnSearch("");
          }}
        >
          <DropdownMenuTrigger render={<Button variant="secondary" size="sm" className="gap-1.5 bg-card" />}>
            <Columns3 className="size-3.5" />
            Columns
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuGroup>
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <DropdownMenuLabel className="p-0 whitespace-nowrap">Toggle columns</DropdownMenuLabel>
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[11px]"
                    onClick={() => toggleableColumns.forEach((c) => c.toggleVisibility(true))}
                  >
                    All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[11px]"
                    onClick={() => toggleableColumns.forEach((c) => c.toggleVisibility(false))}
                  >
                    None
                  </Button>
                </div>
              </div>
              {toggleableColumns.length > COLUMN_SEARCH_THRESHOLD && (
                <div className="px-1.5 pb-1">
                  <Input
                    type="search"
                    value={columnSearch}
                    onChange={(e) => setColumnSearch(e.target.value)}
                    // stop the keystroke from reaching the menu's roving-focus /
                    // typeahead handling — otherwise letters jump-select items
                    // instead of typing into the box.
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Search columns…"
                    className="h-7 text-[12px]"
                  />
                </div>
              )}
              <DropdownMenuSeparator />
              {searchedColumns.map(({ column, cm }) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(checked) => column.toggleVisibility(checked)}
                  closeOnClick={false}
                >
                  {cm?.label ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="relative">
        <RefetchBar isFetching={!!isFetching} isLoading={!!isLoading} />
        <div className="overflow-auto rounded-md border bg-card" style={{ maxHeight }}>
          <Table style={{ tableLayout: "fixed", width: totalWidth, minWidth: totalWidth }}>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((header) => {
                    const w = header.getSize();
                    // the leading row-selection column (Phase 8.2) has no
                    // ColumnMeta — it's a UI control, not a data column.
                    if (header.column.id === "__select") {
                      return (
                        <TableHead
                          key={header.id}
                          className="sticky top-0 z-1 bg-card"
                          style={{ width: w, minWidth: w, maxWidth: w }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      );
                    }
                    const cm = columns.find((c) => c.col.name === header.column.id)!;
                    const active = sort === header.column.id;
                    return (
                      <TableHead
                        key={header.id}
                        className="sticky top-0 z-1 overflow-hidden bg-card"
                        style={{ width: w, minWidth: w, maxWidth: w }}
                        title={`${cm.col.dataType}${cm.col.nullable ? "" : " · not null"}`}
                      >
                        <span
                          className="block cursor-pointer truncate pr-3"
                          onClick={() => onToggleSort(header.column.id)}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {active && <span className="text-primary"> {sortDir === "asc" ? "▲" : "▼"}</span>}
                        </span>
                        <span
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onDoubleClick={() => header.column.resetSize()}
                          onClick={(e) => e.stopPropagation()}
                          className={`absolute top-0 right-0 z-2 h-full w-1 cursor-col-resize touch-none select-none ${
                            header.column.getIsResizing() ? "bg-primary" : "bg-transparent hover:bg-primary/60"
                          }`}
                        />
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading && rows.length === 0
                ? Array.from({ length: 10 }, (_, ri) => (
                    <TableRow key={`sk-${ri}`} className="hover:bg-transparent">
                      {leafColumns.map((col, ci) => {
                        const w = col.getSize();
                        return (
                          <TableCell key={col.id} style={{ width: w, minWidth: w, maxWidth: w }}>
                            <div
                              className="h-3 animate-pulse rounded bg-muted"
                              style={{
                                width: `${SK_WIDTHS[(ri * 3 + ci) % SK_WIDTHS.length]}%`,
                              }}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                : table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={rowClickable ? "cursor-pointer" : ""}
                      onClick={() => onRowClick?.(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const v = cell.getValue<unknown>();
                        const w = cell.column.getSize();
                        return (
                          <TableCell
                            key={cell.id}
                            className="truncate"
                            style={{ width: w, minWidth: w, maxWidth: w }}
                            title={typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "")}
                            onClick={cell.column.id === "__select" ? (e) => e.stopPropagation() : undefined}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
