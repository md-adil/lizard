"use client";

// Phase 8.4 — alternate renderings of the same rows (kanban / gallery /
// calendar / tree). All operate on the currently-loaded page of rows (no extra
// fetch); the Table view remains the source of truth for pagination. Kanban is
// the one that mutates: dropping a card issues an UPDATE of the group column.
import { useState } from "react";
import type { TableMeta } from "./useTableMeta";
import { formatCell } from "./useTableMeta";
import { kanbanGroupColumns } from "./view-types";
import { Card } from "@/components/ui/card";

type Row = Record<string, unknown>;
type FkLabels = Record<string, Record<string, string>>;

function rowPk(meta: TableMeta, row: Row): Record<string, unknown> {
  const pk: Record<string, unknown> = {};
  for (const k of meta.table.primaryKey) pk[k] = row[k];
  return pk;
}

function displayValue(meta: TableMeta, row: Row): string {
  const dc = meta.displayColumn;
  const v = dc ? row[dc] : undefined;
  if (v != null && String(v).trim()) return String(v);
  return meta.table.primaryKey.map((k) => String(row[k])).join(" · ") || "—";
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i;
function imageUrl(row: Row, meta: TableMeta): string | null {
  for (const cm of meta.columns) {
    if (cm.hidden) continue;
    const v = row[cm.col.name];
    if (typeof v === "string" && /^https?:\/\//.test(v) && IMAGE_RE.test(v)) return v;
  }
  return null;
}

// A few key/value lines for a card face (skips the display column + hidden).
function CardFields({ meta, row }: { meta: TableMeta; row: Row }) {
  const cols = meta.columns.filter((c) => !c.hidden && c.col.name !== meta.displayColumn).slice(0, 4);
  return (
    <div className="space-y-0.5 mt-1">
      {cols.map((cm) => {
        const f = formatCell(row[cm.col.name]);
        return (
          <div key={cm.col.name} className="flex gap-2 text-[12px] min-w-0">
            <span className="shrink-0" style={{ color: "var(--muted-foreground-faint)" }}>
              {cm.label}
            </span>
            <span
              className="truncate"
              style={{ color: f.muted ? "var(--muted-foreground-faint)" : "var(--foreground)" }}
            >
              {f.text}
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

// ---------------- Kanban ----------------

export function KanbanView({
  meta,
  rows,
  fkLabels,
  groupBy,
  onOpen,
  onChanged,
}: {
  meta: TableMeta;
  rows: Row[];
  fkLabels: FkLabels;
  groupBy: string;
  onOpen: (row: Row) => void;
  onChanged: () => void;
}) {
  const cm = meta.columns.find((c) => c.col.name === groupBy);
  const isBool = cm?.col.udtName === "bool";
  const nullable = cm?.col.nullable ?? true;
  const canWrite = !meta.isView && meta.table.primaryKey.length > 0;

  // column order: explicit options (enum / check-IN), else booleans, else the
  // distinct values present in the loaded rows.
  const NULL_KEY = "∅";
  let keys: string[];
  if (cm?.options) keys = [...cm.options];
  else if (isBool) keys = ["true", "false"];
  else {
    keys = [
      ...new Set(
        rows
          .map((r) => r[groupBy])
          .filter((v) => v != null)
          .map((v) => String(v)),
      ),
    ];
  }
  if (nullable) keys.push(NULL_KEY);

  const labelFor = (key: string) => {
    if (key === NULL_KEY) return "∅ none";
    if (cm?.ref) return fkLabels[groupBy]?.[key] ?? key;
    return key;
  };
  // Normalize bool values: MySQL returns 1/0, Postgres returns true/false.
  const normalizeBool = (v: unknown): string => {
    if (v === true || v === 1 || v === "1" || v === "true") return "true";
    if (v === false || v === 0 || v === "0" || v === "false") return "false";
    return String(v);
  };
  const groupOf = (row: Row) => {
    const v = row[groupBy];
    if (v == null) return NULL_KEY;
    if (isBool) return normalizeBool(v);
    return String(v);
  };

  async function move(row: Row, toKey: string) {
    if (!canWrite) return;
    const value = toKey === NULL_KEY ? null : toKey;
    if (groupOf(row) === toKey) return;
    const query = meta.schema ? `?schema=${encodeURIComponent(meta.schema)}` : "";
    await fetch(`/api/data/${meta.connection}/${meta.table.name}/row${query}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pk: rowPk(meta, row), data: { [groupBy]: value } }),
    });
    onChanged();
  }

  const [dragging, setDragging] = useState<number | null>(null);

  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-thin pb-2">
      {keys.map((key) => {
        const cards = rows.filter((r) => groupOf(r) === key);
        return (
          <div
            key={key}
            className="w-64 shrink-0 rounded-lg p-2"
            style={{ background: "var(--muted)" }}
            onDragOver={(e) => canWrite && e.preventDefault()}
            onDrop={() => {
              if (dragging != null) move(rows[dragging], key);
              setDragging(null);
            }}
          >
            <div className="flex items-center gap-2 px-1 pb-2 text-[12.5px] font-semibold">
              <span className="truncate">{labelFor(key)}</span>
              <span style={{ color: "var(--muted-foreground-faint)" }}>{cards.length}</span>
            </div>
            <div className="space-y-2">
              {cards.map((row) => {
                const idx = rows.indexOf(row);
                return (
                  <Card
                    key={idx}
                    size="sm"
                    draggable={canWrite}
                    onDragStart={() => setDragging(idx)}
                    onClick={() => onOpen(row)}
                    className="p-3 cursor-pointer hover:ring-2 hover:ring-[var(--primary)]"
                  >
                    <div className="font-medium truncate text-[13px]">{displayValue(meta, row)}</div>
                    <CardFields meta={meta} row={row} />
                  </Card>
                );
              })}
            </div>
          </div>
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

export function CalendarView({
  meta,
  rows,
  dateField,
  onOpen,
}: {
  meta: TableMeta;
  rows: Row[];
  dateField: string;
  onOpen: (row: Row) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

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

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const step = (delta: number) =>
    setCursor((c) => {
      const m = c.m + delta;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });

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
                  {(byDay.get(day) ?? []).slice(0, 4).map((row, j) => (
                    <button
                      key={j}
                      className="block w-full text-left truncate rounded px-1 py-0.5 hoverable"
                      style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
                      onClick={() => onOpen(row)}
                    >
                      {displayValue(meta, row)}
                    </button>
                  ))}
                  {(byDay.get(day)?.length ?? 0) > 4 && (
                    <div style={{ color: "var(--muted-foreground-faint)" }}>+{byDay.get(day)!.length - 4} more</div>
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
  const pkCol = meta.table.primaryKey[0];
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
