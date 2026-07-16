"use client";

// Phase 8.4 — alternate renderings of the same rows (kanban / gallery /
// calendar / tree). All operate on the currently-loaded page of rows (no extra
// fetch); the Table view remains the source of truth for pagination. Kanban is
// the one that mutates: dropping a card issues an UPDATE of the group column.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TableMeta } from "./useTableMeta";
import { formatCell } from "./useTableMeta";
import { dataApiUrl } from "./data-api";
import { kanbanGroupColumns } from "./view-types";
import { Card } from "@/components/ui/card";
import { RedactedValue } from "./redacted-value";
import { effectiveKey } from "@/lib/introspect/heuristics";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPortal,
  PreviewCardPositioner,
  PreviewCardPopup,
} from "@/components/ui/preview-card";
import { PreviewSkeleton } from "./preview-skeleton";

export type Row = Record<string, unknown>;

export function rowPk(meta: TableMeta, row: Row): Record<string, unknown> {
  const pk: Record<string, unknown> = {};
  for (const k of effectiveKey(meta.table)) pk[k] = row[k];
  return pk;
}

export function displayValue(meta: TableMeta, row: Row): string {
  const dc = meta.displayColumn;
  const v = dc ? row[dc] : undefined;
  if (v != null && String(v).trim()) return String(v);
  return effectiveKey(meta.table).map((k) => String(row[k])).join(" · ") || "—";
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i;
function imageUrl(row: Row, meta: TableMeta): string | null {
  for (const cm of meta.columns) {
    if (cm.hidden || cm.hiddenInGrid) continue;
    const v = row[cm.col.name];
    if (typeof v === "string" && /^https?:\/\//.test(v) && IMAGE_RE.test(v)) return v;
  }
  return null;
}

// A few key/value lines for a card face (skips the display column + hidden).
export function CardFields({ meta, row }: { meta: TableMeta; row: Row }) {
  const cols = meta.columns
    .filter((c) => !c.hidden && !c.hiddenInGrid && c.col.name !== meta.displayColumn)
    .slice(0, 4);
  return (
    <div className="space-y-0.5 mt-1">
      {cols.map((cm) => {
        const v = row[cm.col.name];
        const f = cm.redacted ? null : formatCell(v, cm.widget, cm.optionLabels);
        return (
          <div key={cm.col.name} className="flex gap-2 text-[12px] min-w-0">
            <span className="shrink-0" style={{ color: "var(--muted-foreground-faint)" }}>
              {cm.label}
            </span>
            <span
              className="truncate"
              style={{ color: f && !f.muted ? "var(--foreground)" : "var(--muted-foreground-faint)" }}
            >
              {f ? (f.icon ?? f.text) : <RedactedValue value={v} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Gallery ----------------

export function GalleryView({ meta, rows, onOpen }: { meta: TableMeta; rows: Row[]; onOpen: (row: Row) => void }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {rows.map((row, i) => {
        const img = imageUrl(row, meta);
        return (
          <Card
            key={i}
            size="sm"
            className="p-0 cursor-pointer overflow-hidden hover:ring-2 hover:ring-[var(--primary)]"
            onClick={() => onOpen(row)}
          >
            {img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt="" className="w-full h-32 object-cover" style={{ background: "var(--muted)" }} />
            )}
            <div className="p-3">
              <div className="font-medium truncate">{displayValue(meta, row)}</div>
              <CardFields meta={meta} row={row} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------- Calendar ----------------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface CalendarCursor {
  y: number;
  m: number;
}

export function currentCalendarCursor(): CalendarCursor {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() };
}

// Max event chips rendered per day cell; the rest are folded into "+N more".
export const CALENDAR_DAY_DISPLAY_LIMIT = 4;

// Calendar rows only carry pk + display column + date field (see
// listGroupedRows' day-grouping branch) — the chip itself renders just the
// display value, so hovering it fetches the full row by pk (same GET /row
// the row editor uses) and shows a few extra fields, lazily and once.
function CalendarEventPreview({ meta, row, children }: { meta: TableMeta; row: Row; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pk = rowPk(meta, row);

  const { data, isLoading } = useQuery<Record<string, unknown> | null>({
    queryKey: ["calendar-event-preview", meta.connection, meta.schema, meta.table.name, pk],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection: meta.connection,
          table: meta.table.name,
          schema: meta.schema,
          path: "row",
          params: { pk: JSON.stringify(pk) },
        }),
      );
      if (!res.ok) return null;
      const body = await res.json();
      return body.row ?? null;
    },
    enabled: open,
    staleTime: 30_000,
  });

  return (
    <PreviewCard open={open} onOpenChange={setOpen}>
      <PreviewCardTrigger render={<span className="inline" />}>{children}</PreviewCardTrigger>
      <PreviewCardPortal>
        <PreviewCardPositioner>
          <PreviewCardPopup>
            {isLoading ? (
              <PreviewSkeleton rows={4} />
            ) : !data ? (
              <p className="text-[12px] text-muted-foreground">Row not found.</p>
            ) : (
              <div className="space-y-1">
                <div className="mb-1.5 truncate text-[13px] font-semibold">{displayValue(meta, data)}</div>
                <CardFields meta={meta} row={data} />
              </div>
            )}
          </PreviewCardPopup>
        </PreviewCardPositioner>
      </PreviewCardPortal>
    </PreviewCard>
  );
}

export function CalendarView({
  meta,
  rows,
  dateField,
  groupCounts,
  cursor,
  onCursorChange,
  onOpen,
}: {
  meta: TableMeta;
  rows: Row[];
  dateField: string;
  // Exact per-day row count from the server (see listGroupedRows) — the
  // fetch itself is capped at CALENDAR_DAY_DISPLAY_LIMIT rows/day, so the
  // "+N more" total has to come from here rather than rows.length.
  groupCounts?: Record<string, number>;
  cursor: CalendarCursor;
  onCursorChange: (c: CalendarCursor) => void;
  onOpen: (row: Row) => void;
}) {
  const hasKey = effectiveKey(meta.table).length > 0;
  const first = new Date(cursor.y, cursor.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();

  // bucket rows by day-of-month for the visible month
  const byDay = new Map<number, Row[]>();
  for (const row of rows) {
    const raw = row[dateField];
    if (raw == null) continue;
    const d = new Date(String(raw));
    if (isNaN(d.getTime())) continue;
    if (d.getFullYear() === cursor.y && d.getMonth() === cursor.m) {
      const day = d.getDate();
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(row);
    }
  }

  // Exact per-day totals from the server (groupCounts is keyed by the
  // DB's day-truncated value, parsed the same way as row dates above) —
  // the fetch itself is capped, so byDay's array length alone can't tell
  // a full day from a truncated one.
  const dayTotals = new Map<number, number>();
  for (const [key, count] of Object.entries(groupCounts ?? {})) {
    const d = new Date(key);
    if (isNaN(d.getTime())) continue;
    if (d.getFullYear() === cursor.y && d.getMonth() === cursor.m) {
      const day = d.getDate();
      dayTotals.set(day, (dayTotals.get(day) ?? 0) + count);
    }
  }
  const totalFor = (day: number): number => dayTotals.get(day) ?? byDay.get(day)?.length ?? 0;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const step = (delta: number) => {
    const m = cursor.m + delta;
    onCursorChange({ y: cursor.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
  };

  return (
    <div className="panel p-3">
      <div className="flex items-center gap-3 mb-2">
        <button className="btn btn-sm" onClick={() => step(-1)}>
          ‹
        </button>
        <span className="font-semibold text-[14px]">
          {MONTHS[cursor.m]} {cursor.y}
        </span>
        <button className="btn btn-sm" onClick={() => step(1)}>
          ›
        </button>
        <span className="ml-2 text-[11.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
          by {meta.columns.find((c) => c.col.name === dateField)?.label ?? dateField}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="text-[11px] font-medium text-center pb-1"
            style={{ color: "var(--muted-foreground-faint)" }}
          >
            {d}
          </div>
        ))}
        {cells.map((day, i) => (
          <div
            key={i}
            className="min-h-20 rounded border p-1 text-[11px]"
            style={{
              borderColor: "var(--border)",
              background: day ? "var(--card)" : "transparent",
            }}
          >
            {day && (
              <>
                <div style={{ color: "var(--muted-foreground-faint)" }}>{day}</div>
                <div className="space-y-0.5 mt-0.5">
                  {(byDay.get(day) ?? []).slice(0, CALENDAR_DAY_DISPLAY_LIMIT).map((row, j) => {
                    const chip = (
                      <button
                        className="block w-full text-left truncate rounded px-1 py-0.5 hoverable cursor-pointer"
                        style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
                        onClick={() => onOpen(row)}
                      >
                        {displayValue(meta, row)}
                      </button>
                    );
                    return (
                      <div key={j}>
                        {hasKey ? (
                          <CalendarEventPreview meta={meta} row={row}>
                            {chip}
                          </CalendarEventPreview>
                        ) : (
                          chip
                        )}
                      </div>
                    );
                  })}
                  {totalFor(day) > CALENDAR_DAY_DISPLAY_LIMIT && (
                    <div style={{ color: "var(--muted-foreground-faint)" }}>
                      +{totalFor(day) - CALENDAR_DAY_DISPLAY_LIMIT} more
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Tree ----------------

export function TreeView({
  meta,
  rows,
  parentField,
  onOpen,
}: {
  meta: TableMeta;
  rows: Row[];
  parentField: string;
  onOpen: (row: Row) => void;
}) {
  const pkCol = effectiveKey(meta.table)[0];
  if (!pkCol) return null;

  const idOf = (row: Row) => String(row[pkCol]);
  const present = new Set(rows.map(idOf));
  const childrenOf = new Map<string, Row[]>();
  const roots: Row[] = [];
  for (const row of rows) {
    const parent = row[parentField];
    const key = parent == null ? null : String(parent);
    if (key == null || !present.has(key)) roots.push(row);
    else {
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(row);
    }
  }

  return (
    <div className="panel p-2 text-[13px]">
      {roots.map((row) => (
        <TreeNode key={idOf(row)} meta={meta} row={row} childrenOf={childrenOf} idOf={idOf} depth={0} onOpen={onOpen} />
      ))}
      <p className="px-2 pt-1 text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
        Tree is built from the loaded page; deeper descendants may be on other pages.
      </p>
    </div>
  );
}

function TreeNode({
  meta,
  row,
  childrenOf,
  idOf,
  depth,
  onOpen,
}: {
  meta: TableMeta;
  row: Row;
  childrenOf: Map<string, Row[]>;
  idOf: (row: Row) => string;
  depth: number;
  onOpen: (row: Row) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const kids = childrenOf.get(idOf(row)) ?? [];
  return (
    <div>
      <div className="flex items-center gap-1 rounded px-1 py-1 hoverable" style={{ paddingLeft: 4 + depth * 16 }}>
        <button
          className="w-4 text-center shrink-0"
          style={{ color: "var(--muted-foreground-faint)", visibility: kids.length ? "visible" : "hidden" }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "▾" : "▸"}
        </button>
        <button className="flex-1 min-w-0 truncate text-left" onClick={() => onOpen(row)}>
          {displayValue(meta, row)}
        </button>
        {kids.length > 0 && (
          <span className="tag shrink-0" style={{ fontSize: 10 }}>
            {kids.length}
          </span>
        )}
      </div>
      {open &&
        kids.map((child) => (
          <TreeNode
            key={idOf(child)}
            meta={meta}
            row={child}
            childrenOf={childrenOf}
            idOf={idOf}
            depth={depth + 1}
            onOpen={onOpen}
          />
        ))}
    </div>
  );
}

// re-export for the switcher's group-picker
export { kanbanGroupColumns };
