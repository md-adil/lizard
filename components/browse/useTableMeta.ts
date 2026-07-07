"use client";

// Client-side view of one table's metadata: catalog info merged with
// overrides + virtual FKs. Heuristics are pure functions shared with the server.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ConnectionCatalog,
  TableInfo,
  VirtualFk,
  TableOverride,
  ColumnOverride,
  ColumnInfo,
  VfkTransform,
} from "@/lib/types";
import {
  findUpdatedAtColumn,
  guessWidget,
  guessReadonly,
  guessRedacted,
  guessDisplayColumn,
  selectOptions,
  humanize,
  type Widget,
} from "@/lib/introspect/heuristics";
import { vfkMatchesSource, resolveToSchema, vfkDisplayColumn, vfkTargetColumn } from "@/lib/introspect/virtual-fk";
import { resolveTableOverride, resolveColumnOverrides } from "@/lib/introspect/overrides";

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
  redacted: boolean;
  help: string | null;
  options: string[] | null;
  // where a reference picker should search: real FK or virtual FK target
  ref: {
    connection: string;
    schema: string;
    table: string;
    column: string;
    // value transform applied symmetrically to both sides of the join (see
    // VfkPair.transform) — "none" for real FKs, which are always exact.
    transform: VfkTransform;
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
  const table = conn?.schemas.find((s) => s.name === schema)?.tables.find((t) => t.name === tableName);
  if (!conn || !table) return null;

  const tOverride = resolveTableOverride(catalog.tableOverrides, conn.connectionId, schema, tableName);
  const cOverrides = resolveColumnOverrides(catalog.columnOverrides, conn.connectionId, schema, tableName);
  const vfks = catalog.virtualFks.filter((v) => vfkMatchesSource(v, connection, schema, tableName));

  const columns: ColumnMeta[] = table.columns.map((col) => {
    const o = cOverrides.find((x) => x.column === col.name);
    const baseWidget = guessWidget(table, col);
    const widget = (o?.widget as Widget) || baseWidget;
    const realFk = table.foreignKeys.find((fk) => fk.columns.length === 1 && fk.columns[0] === col.name);
    const vfk = vfks.find((v) => vfkDisplayColumn(v) === col.name);
    const ref = realFk
      ? {
          connection,
          schema: realFk.referencedSchema,
          table: realFk.referencedTable,
          column: realFk.referencedColumns[0],
          transform: "none" as VfkTransform,
        }
      : vfk
        ? {
            connection: vfk.toConnection,
            schema: resolveToSchema(vfk, schema),
            table: vfk.toTable,
            column: vfkTargetColumn(vfk)!,
            transform: vfk.pairs[0]?.transform ?? "none",
          }
        : null;
    return {
      col,
      label: o?.label || humanize(col.name),
      widget: ref ? "reference" : widget,
      hidden: o?.hidden ?? false,
      readonly: o?.readonly ?? guessReadonly(table, col),
      redacted: o?.redacted ?? guessRedacted(col),
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

// Fetches the catalog and builds one table's TableMeta from route params —
// the common case across browse/customize/record pages and reference
// pickers. Components that already have `catalog` from a parent (e.g. to
// build meta for several tables at once) should keep calling buildTableMeta
// directly instead.
export function useTableMeta(connection: string | undefined, schema: string | undefined, table: string | undefined) {
  const { data: catalog, isLoading, error } = useCatalog();
  const meta = useMemo(
    () => (catalog && connection && schema && table ? buildTableMeta(catalog, connection, schema, table) : null),
    [catalog, connection, schema, table],
  );
  return { meta, catalog, isLoading, error };
}

const INTERVAL_KEYS = new Set(["years", "months", "days", "hours", "minutes", "seconds", "milliseconds"]);
const INTERVAL_SUFFIX: Record<string, string> = {
  years: "y",
  months: "mo",
  days: "d",
  hours: "h",
  minutes: "m",
  seconds: "s",
  milliseconds: "ms",
};

// Values arrive JSON-serialized from the API, so Postgres arrays stay arrays,
// bytea becomes { type: "Buffer", data: [...] }, and interval becomes an object
// of {hours,minutes,...}. Render each readably instead of dumping raw JSON.
export function formatCell(value: unknown): { text: string; muted: boolean } {
  if (value === null || value === undefined) return { text: "∅", muted: true };
  if (typeof value === "boolean") return { text: value ? "✓" : "✗", muted: !value };
  if (Array.isArray(value)) {
    if (value.length === 0) return { text: "[]", muted: true };
    const parts = value.map((v) =>
      v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v),
    );
    const text = parts.join(", ");
    return {
      text: text.length > 120 ? text.slice(0, 120) + "…" : text,
      muted: false,
    };
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // bytea → { type: "Buffer", data: number[] }
    if (o.type === "Buffer" && Array.isArray(o.data)) {
      return { text: `⬇ ${o.data.length} bytes`, muted: true };
    }
    // interval → { hours, minutes, ... }
    const keys = Object.keys(o);
    if (keys.length > 0 && keys.every((k) => INTERVAL_KEYS.has(k))) {
      const parts = keys.filter((k) => Number(o[k])).map((k) => `${o[k]}${INTERVAL_SUFFIX[k]}`);
      return { text: parts.length ? parts.join(" ") : "0s", muted: !parts.length };
    }
    return { text: JSON.stringify(value), muted: false };
  }
  const s = String(value);
  // compact ISO timestamps
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}/);
  if (m) return { text: `${m[1]} ${m[2]}`, muted: false };
  return { text: s.length > 120 ? s.slice(0, 120) + "…" : s, muted: false };
}
