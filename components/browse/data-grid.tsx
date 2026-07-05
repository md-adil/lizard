"use client";

// Data grid built on @tanstack/react-table + shadcn's Table primitives.
// table-layout:fixed + an explicit width on every th/td (driven by TanStack
// column sizing that we hold in React state) guarantees header/body alignment
// AND live-updating column resize. Sorting stays server-side: header clicks
// call back to the parent to refetch. The outer scroll container (not
// shadcn's own Table wrapper, which would nest a second overflow-x-auto and
// break the sticky header) is kept from the original implementation.
import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
  type ColumnSizingState,
  type VisibilityState,
  type Updater,
} from "@tanstack/react-table";
import { Loader2, Columns3 } from "lucide-react";
import type { ColumnMeta } from "./useTableMeta";
import { formatCell } from "./useTableMeta";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

type Row = Record<string, unknown>;

interface Props {
  columns: ColumnMeta[];
  rows: Row[];
  fkLabels: Record<string, Record<string, string>>;
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
}

const helper = createColumnHelper<Row>();

// deterministic skeleton cell widths to avoid re-render flicker
const SK_WIDTHS = [72, 55, 88, 64, 91, 48, 76, 60, 83, 44];

// initial width heuristic: short types narrow, references/text wider
function defaultWidth(cm: ColumnMeta): number {
  if (["bool", "int2", "int4", "int8", "date"].includes(cm.col.udtName))
    return 120;
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
}: Props) {
  // holding sizing in React state guarantees a re-render on every resize tick
  const [colSizing, setColSizing] = useState<ColumnSizingState>({});
  const [localVisibility, setLocalVisibility] = useState<VisibilityState>({});
  const columnVisibility = controlledVisibility ?? localVisibility;
  const setColumnVisibility = onColumnVisibilityChange ?? setLocalVisibility;

  const colDefs = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((cm) =>
        helper.accessor((r) => r[cm.col.name], {
          id: cm.col.name,
          header: cm.label,
          size: defaultWidth(cm),
          minSize: 64,
          maxSize: 800,
          cell: (info) => {
            const v = info.getValue<unknown>();
            const label =
              cm.ref && v != null
                ? fkLabels[cm.col.name]?.[String(v)]
                : undefined;
            if (label) {
              return (
                <>
                  {label}{" "}
                  <span className="tag code" style={{ fontSize: 10 }}>
                    {String(v)}
                  </span>
                </>
              );
            }
            const f = formatCell(v);
            return (
              <span
                style={{ color: f.muted ? "var(--text-faint)" : undefined }}
              >
                {f.text}
              </span>
            );
          },
        }),
      ),
    [columns, fkLabels],
  );

  const table = useReactTable({
    data: rows,
    columns: colDefs,
    state: { columnSizing: colSizing, columnVisibility },
    onColumnSizingChange: setColSizing,
    onColumnVisibilityChange: setColumnVisibility,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
  });

  const leafColumns = table.getVisibleLeafColumns();
  const totalWidth = table.getTotalSize();

  const showRefetchOverlay = isFetching && !isLoading;

  return (
    <div>
      <div className="flex justify-end mb-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" className="gap-1.5" />}
          >
            <Columns3 className="size-3.5" />
            Columns
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table.getAllLeafColumns().map((column) => {
                const cm = columns.find((c) => c.col.name === column.id);
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(checked) =>
                      column.toggleVisibility(checked)
                    }
                    closeOnClick={false}
                  >
                    {cm?.label ?? column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div style={{ position: "relative" }}>
        <div
          className="panel overflow-auto scrollbar-thin"
          style={{
            maxHeight,
            opacity: showRefetchOverlay ? 0.6 : 1,
            transition: "opacity 120ms",
          }}
        >
          <table
            className="grid"
            style={{
              tableLayout: "fixed",
              width: totalWidth,
              minWidth: totalWidth,
            }}
          >
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => {
                    const cm = columns.find(
                      (c) => c.col.name === header.column.id,
                    )!;
                    const active = sort === header.column.id;
                    const w = header.getSize();
                    return (
                      <TableHead
                        key={header.id}
                        style={{
                          width: w,
                          minWidth: w,
                          maxWidth: w,
                          position: "sticky",
                          top: 0,
                        }}
                        title={`${cm.col.dataType}${cm.col.nullable ? "" : " · not null"}`}
                      >
                        <span
                          className="th-label cursor-pointer"
                          style={{ paddingRight: 12 }}
                          onClick={() => onToggleSort(header.column.id)}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {active && (
                            <span style={{ color: "var(--accent)" }}>
                              {" "}
                              {sortDir === "asc" ? "▲" : "▼"}
                            </span>
                          )}
                        </span>
                        <span
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onDoubleClick={() => header.column.resetSize()}
                          onClick={(e) => e.stopPropagation()}
                          className={`resizer-handle${header.column.getIsResizing() ? " is-resizing" : ""}`}
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
                    <TableRow key={`sk-${ri}`}>
                      {leafColumns.map((col, ci) => {
                        const w = col.getSize();
                        return (
                          <TableCell
                            key={col.id}
                            style={{ width: w, minWidth: w, maxWidth: w }}
                          >
                            <div
                              className="animate-pulse rounded"
                              style={{
                                height: 12,
                                background: "var(--border)",
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
                            style={{ width: w, minWidth: w, maxWidth: w }}
                            title={
                              typeof v === "object" && v !== null
                                ? JSON.stringify(v)
                                : String(v ?? "")
                            }
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
            </TableBody>
          </table>
          {leafColumns.length === 0 && null}
        </div>
        {showRefetchOverlay && (
          <div
            className="flex items-center justify-center"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            <Loader2
              size={20}
              className="animate-spin"
              style={{ color: "var(--accent)" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
