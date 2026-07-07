"use client";

// Phase 8.4 — which alternate views a table can offer, derived from its schema.
import type { TableMeta, ColumnMeta } from "./useTableMeta";

export type ViewType = "table" | "kanban" | "gallery" | "calendar" | "tree";

export const VIEW_LABELS: Record<ViewType, string> = {
  table: "▤ Table",
  kanban: "▥ Kanban",
  gallery: "▦ Gallery",
  calendar: "▧ Calendar",
  tree: "▤ Tree",
};

// Columns worth grouping a kanban by: enum / check-IN / boolean / single FK.
export function kanbanGroupColumns(meta: TableMeta): ColumnMeta[] {
  return meta.columns.filter((c) => !c.hidden && (!!c.options || c.col.udtName === "bool" || !!c.ref));
}

// Date/timestamp columns a calendar can place rows on.
export function dateColumns(meta: TableMeta): ColumnMeta[] {
  return meta.columns.filter((c) => !c.hidden && (c.col.udtName === "date" || c.col.udtName.startsWith("timestamp")));
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
