"use client";

// Phase 8.4 — which alternate views a table can offer, derived from its schema.
import { Table, Kanban, GalleryHorizontal, Calendar, ListTree, type LucideIcon } from "lucide-react";
import type { TableMeta, ColumnMeta } from "./useTableMeta";

export type ViewType = "table" | "kanban" | "gallery" | "calendar" | "tree";

export const VIEW_LABELS: Record<ViewType, string> = {
  table: "Table",
  kanban: "Kanban",
  gallery: "Gallery",
  calendar: "Calendar",
  tree: "Tree",
};

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table,
  kanban: Kanban,
  gallery: GalleryHorizontal,
  calendar: Calendar,
  tree: ListTree,
};

// Below this row-estimate, listGroupedRows' DISTINCT/windowed-fetch/COUNT
// queries are cheap enough on a full scan that we don't need an index to
// offer a grouped view — same threshold listRows uses for exact counts (see
// lib/data/crud.ts). Unlike defaultSortFor's indexed-only policy (an
// invisible, automatic pick where any unindexed cost is a silent surprise),
// kanban/calendar are a deliberate, user-initiated choice, so a small-table
// carve-out is safe here.
const SMALL_TABLE_ROW_THRESHOLD = 100_000;

// Columns worth grouping a kanban by: enum / check-IN / boolean / single FK,
// restricted to indexed columns once the table is too big to full-scan
// cheaply — see listGroupedRows in lib/data/crud.ts.
export function kanbanGroupColumns(meta: TableMeta): ColumnMeta[] {
  const smallTable = meta.table.rowEstimate < SMALL_TABLE_ROW_THRESHOLD;
  return meta.columns.filter(
    (c) =>
      !c.hidden &&
      (!!c.options || c.col.udtName === "bool" || !!c.ref) &&
      (smallTable || meta.table.indexedColumns.includes(c.col.name)),
  );
}

// Date/timestamp columns a calendar can place rows on. Unlike kanban, calendar
// requires the column to be **indexed** regardless of table size: the calendar
// loads each visible day via a range predicate (col >= day AND col < day+1, see
// listGroupedRows' day branch), which is only cheap when that predicate is
// index-backed. An unindexed date column would turn every day into a full scan,
// so such columns simply aren't offered a calendar view.
export function dateColumns(meta: TableMeta): ColumnMeta[] {
  return meta.columns.filter(
    (c) =>
      !c.hidden &&
      (c.col.udtName === "date" || c.col.udtName.startsWith("timestamp")) &&
      meta.table.indexedColumns.includes(c.col.name),
  );
}

// The single-column FK that points back at this same table, if any (→ tree).
export function selfRefColumn(meta: TableMeta): string | null {
  const fk = meta.table.foreignKeys.find(
    (f) => f.columns.length === 1 && f.referencedTable === meta.table.name && f.referencedSchema === meta.schema,
  );
  return fk?.columns[0] ?? null;
}

export function availableViews(meta: TableMeta): ViewType[] {
  const v: ViewType[] = ["table", "gallery"];
  if (kanbanGroupColumns(meta).length) v.push("kanban");
  if (dateColumns(meta).length) v.push("calendar");
  if (selfRefColumn(meta)) v.push("tree");
  return v;
}
