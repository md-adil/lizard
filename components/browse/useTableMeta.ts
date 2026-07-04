"use client";

// Client-side view of one table's metadata: catalog info merged with
// overrides + virtual FKs. Heuristics are pure functions shared with the server.
import { useQuery } from "@tanstack/react-query";
import type {
  ConnectionCatalog,
  TableInfo,
  VirtualFk,
  TableOverride,
  ColumnOverride,
  ColumnInfo,
} from "@/lib/types";
import {
  findUpdatedAtColumn,
  guessWidget,
  guessDisplayColumn,
  selectOptions,
  humanize,
  type Widget,
} from "@/lib/introspect/heuristics";

export interface CatalogResponse {
  connections: ConnectionCatalog[];
  virtualFks: VirtualFk[];
  tableOverrides: TableOverride[];
  columnOverrides: ColumnOverride[];
}

export function useCatalog() {
  return useQuery<CatalogResponse>({
    queryKey: ["catalog"],
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error("Failed to load catalog");
      return res.json();
    },
  });
}

export interface ColumnMeta {
  col: ColumnInfo;
  label: string;
  widget: Widget;
  hidden: boolean;
  readonly: boolean;
  help: string | null;
  options: string[] | null;
  // where a reference picker should search: real FK or virtual FK target
  ref: {
    connection: string;
    schema: string;
    table: string;
    column: string;
  } | null;
  required: boolean;
}

export interface TableMeta {
  connection: string;
  connectionId: string;
  schema: string;
  table: TableInfo;
  label: string;
  isView: boolean;
  columns: ColumnMeta[]; // ordered, includes hidden (filter where needed)
  displayColumn: string | null;
  tableOverride: TableOverride | null;
  virtualFks: VirtualFk[]; // outgoing from this table
  updatedAtColumn: string | null;
}

export function buildTableMeta(
  catalog: CatalogResponse,
  connection: string,
  schema: string,
  tableName: string,
): TableMeta | null {
  const conn = catalog.connections.find((c) => c.connectionName === connection);
  const table = conn?.schemas
    .find((s) => s.name === schema)
    ?.tables.find((t) => t.name === tableName);
  if (!conn || !table) return null;

  const tOverride =
    catalog.tableOverrides.find(
      (o) =>
        o.connectionId === conn.connectionId &&
        o.schema === schema &&
        o.table === tableName,
    ) ?? null;
  const cOverrides = catalog.columnOverrides.filter(
    (o) =>
      o.connectionId === conn.connectionId &&
      o.schema === schema &&
      o.table === tableName,
  );
  const vfks = catalog.virtualFks.filter(
    (v) =>
      v.fromConnection === connection &&
      v.fromSchema === schema &&
      v.fromTable === tableName,
  );

  const columns: ColumnMeta[] = table.columns.map((col) => {
    const o = cOverrides.find((x) => x.column === col.name);
    const baseWidget = guessWidget(table, col);
    const widget = (o?.widget as Widget) || baseWidget;
    const realFk = table.foreignKeys.find(
      (fk) => fk.columns.length === 1 && fk.columns[0] === col.name,
    );
    const vfk = vfks.find((v) => v.fromColumn === col.name);
    const ref = realFk
      ? {
          connection,
          schema: realFk.referencedSchema,
          table: realFk.referencedTable,
          column: realFk.referencedColumns[0],
        }
      : vfk
        ? {
            connection: vfk.toConnection,
            schema: vfk.toSchema,
            table: vfk.toTable,
            column: vfk.toColumn,
          }
        : null;
    return {
      col,
      label: o?.label || humanize(col.name),
      widget: ref && widget !== "readonly" ? "reference" : widget,
      hidden: o?.hidden ?? false,
      readonly:
        (o?.readonly ?? false) ||
        widget === "readonly" ||
        baseWidget === "readonly",
      help: o?.help ?? col.comment,
      options: selectOptions(table, col),
      ref,
      required: !col.nullable && col.default === null && !col.isGenerated,
    };
  });

  // apply sortOrder overrides (stable for un-ordered)
  columns.sort((a, b) => {
    const ao = cOverrides.find((x) => x.column === a.col.name)?.sortOrder;
    const bo = cOverrides.find((x) => x.column === b.col.name)?.sortOrder;
    return (ao ?? a.col.ordinal) - (bo ?? b.col.ordinal);
  });

  return {
    connection,
    connectionId: conn.connectionId,
    schema,
    table,
    label: tOverride?.label || humanize(tableName),
    isView: table.kind === "view",
    columns,
    displayColumn: tOverride?.displayColumn || guessDisplayColumn(table),
    tableOverride: tOverride,
    virtualFks: vfks,
    updatedAtColumn: findUpdatedAtColumn(table.columns),
  };
}

export function formatCell(value: unknown): { text: string; muted: boolean } {
  if (value === null || value === undefined) return { text: "∅", muted: true };
  if (typeof value === "boolean")
    return { text: value ? "✓" : "✗", muted: !value };
  if (typeof value === "object")
    return { text: JSON.stringify(value), muted: false };
  const s = String(value);
  // compact ISO timestamps
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}/);
  if (m) return { text: `${m[1]} ${m[2]}`, muted: false };
  return { text: s.length > 120 ? s.slice(0, 120) + "…" : s, muted: false };
}
