"use client";

import type { QueryResult } from "@/lib/types";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { formatCell } from "@/components/browse/useTableMeta";

export function ResultGrid({
  result,
  maxRows = 100,
  maxHeight = 420,
  onRowClick,
}: {
  result: QueryResult;
  maxRows?: number;
  // Bounded contexts (a dashboard panel) pass their real available height so
  // the scroll region can't spill past the card; unbounded ones (AI console,
  // panel-preview modal) keep the 420px default.
  maxHeight?: number;
  // Set (by a panel with spec.linkTo) to make rows clickable — mirrors
  // DataGrid's onRowClick/rowClickable in components/browse/data-grid.tsx.
  onRowClick?: (row: Record<string, unknown>) => void;
}) {
  const rows = result.rows.slice(0, maxRows);
  return (
    <div>
      <div
        className="bg-card border border-border rounded-xl overflow-x-auto scrollbar-thin"
        style={{ maxHeight, overflowY: "auto" }}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {result.columns.map((c) => (
                <TableHead key={c.name} title={c.type}>
                  {c.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow
                key={i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined}
              >
                {result.columns.map((c) => {
                  const v = row[c.name];
                  // No column metadata for an ad hoc SQL result (unlike the
                  // browse grid's TableMeta) — formatCell without a widget
                  // still gets consistent null/boolean/array/date formatting.
                  const f = formatCell(v);
                  return (
                    <TableCell
                      key={c.name}
                      title={String(v ?? "")}
                      style={{ color: f.muted ? "var(--muted-foreground-faint)" : "var(--foreground)" }}
                    >
                      {f.icon ?? f.text}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
            No rows returned.
          </p>
        )}
      </div>
      <div className="flex gap-3 mt-1.5 text-[12px]" style={{ color: "var(--muted-foreground-faint)" }}>
        <span>
          {result.rowCount.toLocaleString()} rows{result.truncated && " (truncated at cap)"}
        </span>
        <span>{result.durationMs} ms</span>
        {result.rowCount > maxRows && <span>showing first {maxRows}</span>}
      </div>
    </div>
  );
}
