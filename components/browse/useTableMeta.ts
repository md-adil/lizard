"use client";

// Client-side view of one table's metadata: catalog info merged with
// overrides + virtual FKs. Heuristics are pure functions shared with the server.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  TableInfo,
  VirtualFk,
  TableOverride,
  ColumnInfo,
  VfkTransform,
  CatalogResponse,
  SchemaDetail,
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
import { supportsSchemas } from "@/lib/types";

export type { CatalogResponse, SchemaDetail } from "@/lib/types";

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

// Does the named connection expose a real schema namespace? A virtual FK can
// point at a different connection (with a different engine) than its source
// table, so eligibility can't be inferred from the source's engine — it has
// to be looked up per target connection.
export function connectionSupportsSchemas(catalog: CatalogResponse, connectionName: string): boolean {
  const engine = catalog.connections.find((c) => c.connectionName === connectionName)?.engine;
  return !!engine && supportsSchemas(engine);
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
  // where a reference picker should search: real FK or virtual FK target.
  // schema is undefined when the target connection doesn't have one (see
  // TableMeta.schema) — it may point at a different connection than the
  // table this column belongs to (virtual FKs can cross connections).
  ref: {
    connection: string;
    schema: string | undefined;
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
  // The schema as the user sees it: a real Postgres schema, or undefined for
  // MySQL/Mongo, where a connection maps to exactly one database and there's
  // nothing worth naming (see supportsSchemas). Use this for URLs, `?schema=`
  // query params, and anything displayed. `schema === undefined` is also the
  // canonical "this engine has no schemas" test — don't re-check the engine.
  schema: string | undefined;
  // The same schema, always concrete: Postgres's real schema, or the synthetic
  // one introspection reports for MySQL (the database name). This is the
  // identifier overrides/saved-views/column-prefs/comments are keyed by and
  // that SQL quotes — never show it, never put it in a URL.
  resolvedSchema: string;
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
  schemaMeta: SchemaDetail,
  connection: string,
  tableName: string,
  table: TableInfo,
): TableMeta | null {
  const conn = catalog.connections.find((c) => c.connectionName === connection);
  if (!conn || !table) return null;

  // The resolved schema name always exists (Postgres: a real schema; MySQL:
  // the database name introspection reports as a synthetic one) and is what
  // overrides/virtual-FKs are actually stored/matched against, regardless of
  // whether this engine's schema is worth exposing to the UI.
  const schema = schemaMeta.name;
  const tOverride = resolveTableOverride(schemaMeta.tableOverrides, conn.connectionId, schema, tableName);
  const cOverrides = resolveColumnOverrides(schemaMeta.columnOverrides, conn.connectionId, schema, tableName);
  const vfks = schemaMeta.virtualFks.filter((v) => vfkMatchesSource(v, connection, schema, tableName));

  const hasSchema = connectionSupportsSchemas(catalog, connection);

  const columns: ColumnMeta[] = table.columns.map((col) => {
    const o = cOverrides.find((x) => x.column === col.name);
    const baseWidget = guessWidget(table, col);
    const widget = (o?.widget as Widget) || baseWidget;
    const realFk = table.foreignKeys.find((fk) => fk.columns.length === 1 && fk.columns[0] === col.name);
    const vfk = vfks.find((v) => vfkDisplayColumn(v) === col.name);
    const ref = realFk
      ? {
          // real FKs never cross connections, so the target shares this
          // table's engine.
          connection,
          schema: hasSchema ? realFk.referencedSchema : undefined,
          table: realFk.referencedTable,
          column: realFk.referencedColumns[0],
          transform: "none" as VfkTransform,
        }
      : vfk
        ? {
            connection: vfk.toConnection,
            schema: connectionSupportsSchemas(catalog, vfk.toConnection) ? resolveToSchema(vfk, schema) : undefined,
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
    schema: hasSchema ? schema : undefined,
    resolvedSchema: schema,
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
export function useSchemaMeta(connection: string | undefined, schema: string | undefined) {
  const { data: schemaMeta, isLoading, error } = useQuery<SchemaDetail>({
    queryKey: ["schema-meta", connection, schema],
    queryFn: async () => {
      const url = `/api/catalog/${connection}${schema ? `?schema=${encodeURIComponent(schema)}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load schema metadata");
      return res.json();
    },
    enabled: !!connection,
    staleTime: 60_000,
  });
  return { schemaMeta, isLoading, error };
}

// `schema` is only meaningful for Postgres — omit it for MySQL/Mongo (or
// when the caller doesn't know it yet) and the server resolves it to the
// connection's one schema, or Postgres's "public" default.
export function useTableMeta(connection: string | undefined, schema: string | undefined, table: string | undefined) {
  const { data: catalog } = useCatalog();
  const { schemaMeta, isLoading, error } = useSchemaMeta(connection, schema);

  const meta = useMemo(() => {
    if (!catalog || !connection || !table || !schemaMeta) return null;
    const tableInfo = schemaMeta.tables.find((t) => t.name === table);
    if (!tableInfo) return null;
    return buildTableMeta(catalog, schemaMeta, connection, table, tableInfo);
  }, [catalog, connection, table, schemaMeta]);

  return { meta, catalog, schemaMeta, isLoading: isLoading || !catalog, error };
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
