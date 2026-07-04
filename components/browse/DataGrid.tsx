"use client";

// Data grid built on @tanstack/react-table. table-layout:fixed + an explicit
// width on every th/td (driven by TanStack column sizing that we hold in React
// state) guarantees header/body alignment AND live-updating column resize.
// Sorting stays server-side: header clicks call back to the parent to refetch.
import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import type { ColumnMeta } from "./useTableMeta";
import { formatCell } from "./useTableMeta";

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
}: Props) {
  // holding sizing in React state guarantees a re-render on every resize tick
  const [colSizing, setColSizing] = useState<ColumnSizingState>({});

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
    state: { columnSizing: colSizing },
    onColumnSizingChange: setColSizing,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
  });

  const leafColumns = table.getVisibleLeafColumns();
  const totalWidth = table.getTotalSize();

  return (
    <div className="panel overflow-auto scrollbar-thin" style={{ maxHeight }}>
      <table
        className="grid"
        style={{
          tableLayout: "fixed",
          width: totalWidth,
          minWidth: totalWidth,
        }}
      >
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const cm = columns.find(
                  (c) => c.col.name === header.column.id,
                )!;
                const active = sort === header.column.id;
                const w = header.getSize();
                return (
                  <th
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
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {isLoading && rows.length === 0
            ? Array.from({ length: 10 }, (_, ri) => (
                <tr key={`sk-${ri}`}>
                  {leafColumns.map((col, ci) => {
                    const w = col.getSize();
                    return (
                      <td
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
                      </td>
                    );
                  })}
                </tr>
              ))
            : table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={rowClickable ? "cursor-pointer" : ""}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const v = cell.getValue<unknown>();
                    const w = cell.column.getSize();
                    return (
                      <td
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
                      </td>
                    );
                  })}
                </tr>
              ))}
        </tbody>
      </table>
      {leafColumns.length === 0 && null}
    </div>
  );
}
