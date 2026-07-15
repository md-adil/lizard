"use client";

// Client-side view of one table's metadata: catalog info merged with
// overrides + virtual FKs. Heuristics are pure functions shared with the server.
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X, ExternalLink, Mail, Star } from "lucide-react";
import type { TableInfo, VirtualFk, TableOverride, ColumnInfo, CatalogResponse, SchemaDetail } from "@/lib/types";
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
import { toBoolean, getLocalCurrency } from "@/lib/data/widgets";
import { CurrencyCell } from "./currency-cell";
import { PercentCell } from "./percent-cell";
import { MarkdownCell } from "./markdown-cell";
import { AvatarCell } from "./avatar-cell";
import { TimezoneCell } from "./timezone-cell";
import { TagCell } from "./tag-cell";
import { useCatalog } from "./use-catalog";

export type { CatalogResponse, SchemaDetail } from "@/lib/types";

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
  // Hides from the grid/kanban/gallery cards only — record view/edit still
  // show it (see ColumnOverride.hiddenInGrid).
  hiddenInGrid: boolean;
  readonly: boolean;
  redacted: boolean;
  help: string | null;
  options: string[] | null;
  // raw option value -> display label (e.g. "m" -> "Male"); null when unset.
  optionLabels: Record<string, string> | null;
  // where a reference picker should search: real FK or virtual FK target.
  // schema is undefined when the target connection doesn't have one (see
  // TableMeta.schema) — it may point at a different connection than the
  // table this column belongs to (virtual FKs can cross connections).
  ref: {
    connection: string;
    schema: string | undefined;
    table: string;
    column: string;
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
  // whether introspection found a real PK/unique constraint, BEFORE any
  // pretend-PK override is overlaid onto table.primaryKey below — the
  // overlay is indistinguishable from a real key by the time it's on
  // `table`, so anything that needs to know "does this table actually have
  // one" (e.g. the customize page deciding whether to offer the pretend-PK
  // picker) must read this instead of `table.primaryKey.length > 0`.
  hasRealKey: boolean;
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
  // fromConnection/toConnection on a VirtualFk store the connection id, not
  // its (mutable) name — match against conn.connectionId, not the name param.
  const vfks = schemaMeta.virtualFks.filter((v) => vfkMatchesSource(v, conn.connectionId, schema, tableName));

  const hasSchema = connectionSupportsSchemas(catalog, connection);

  const columns: ColumnMeta[] = table.columns.map((col) => {
    const o = cOverrides.find((x) => x.column === col.name);
    const baseWidget = guessWidget(table, col);
    // custom options (no native enum/check constraint) activate the select
    // widget on their own, without also requiring `widget` to be set.
    const widget = (o?.widget as Widget) || (o?.options?.length ? "select" : baseWidget);
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
        }
      : vfk
        ? (() => {
            // vfk.toConnection is a connection id — every downstream consumer
            // of ref.connection (routing, dataApiUrl, connectionSupportsSchemas)
            // expects a name, so resolve it here, once, at the boundary.
            const toConnName = catalog.connections.find((c) => c.connectionId === vfk.toConnection)?.connectionName;
            return toConnName
              ? {
                  connection: toConnName,
                  schema: connectionSupportsSchemas(catalog, toConnName) ? resolveToSchema(vfk, schema) : undefined,
                  table: vfk.toTable,
                  column: vfkTargetColumn(vfk)!,
                }
              : null;
          })()
        : null;
    return {
      col,
      label: o?.label || humanize(col.name),
      widget,
      hidden: o?.hidden ?? false,
      hiddenInGrid: o?.hiddenInGrid ?? false,
      readonly: o?.readonly ?? guessReadonly(table, col),
      redacted: o?.redacted ?? guessRedacted(col),
      help: o?.help ?? col.comment,
      options: o?.options?.length ? o.options : selectOptions(table, col),
      optionLabels: o?.optionLabels ?? null,
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

  const hasRealKey = table.primaryKey.length > 0 || table.uniqueConstraints.length > 0;

  // "pretend" PK for a table with no real PK/unique constraint (see
  // TableOverride.primaryKey) — every effectiveKey(meta.table) call site
  // (row click, bulk delete, pk object construction) picks this up for
  // free. Ignored when the table already has a real key, so it can't
  // conflict with pkWhere's strict server-side check for that case.
  const effectiveTable =
    tOverride?.primaryKey?.length && !hasRealKey ? { ...table, primaryKey: tOverride.primaryKey } : table;

  return {
    connection,
    connectionId: conn.connectionId,
    schema: hasSchema ? schema : undefined,
    resolvedSchema: schema,
    table: effectiveTable,
    label: tOverride?.label || humanize(tableName),
    isView: table.kind === "view",
    columns,
    hasRealKey,
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
  const {
    data: schemaMeta,
    isLoading,
    error,
  } = useQuery<SchemaDetail>({
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
export function formatCell(
  value: unknown,
  widget?: Widget,
  optionLabels?: Record<string, string> | null,
): { text: string; muted: boolean; icon?: ReactNode } {
  if (value === null || value === undefined) return { text: "∅", muted: true };

  if (widget === "markdown") {
    return {
      text: String(value),
      muted: false,
      icon: <MarkdownCell value={value} />,
    };
  }
  if (widget === "avatar") {
    return {
      text: String(value),
      muted: false,
      icon: <AvatarCell value={value} />,
    };
  }
  if (widget === "timezone") {
    return {
      text: String(value),
      muted: false,
      icon: <TimezoneCell value={value} />,
    };
  }
  if (widget === "tag") {
    // normalized to string[] server-side (see normalizeTagColumns in
    // app/api/data/crud.ts) — every tag column value is an array by the time it
    // reaches the client.
    const tags = value as string[];
    return {
      text: tags.join(", "),
      muted: false,
      icon: <TagCell value={tags} />,
    };
  }

  if (widget === "percent") {
    return {
      text: `${value}%`,
      muted: false,
      icon: <PercentCell value={value} />,
    };
  }
  if (widget === "rating") {
    const rate = Math.round(Number(value)) || 0;
    const cleanRate = Math.min(5, Math.max(0, rate));
    return {
      text: `${cleanRate}/5`,
      muted: false,
      icon: (
        <span className="flex items-center gap-0.5" title={`${cleanRate}/5 stars`}>
          {Array.from({ length: 5 }).map((_, idx) => (
            <Star
              key={idx}
              className={`size-3 shrink-0 ${
                idx < cleanRate ? "fill-amber-400 text-amber-400" : "text-muted/40"
              }`}
            />
          ))}
        </span>
      ),
    };
  }
  if (widget === "currency") {
    // Generate text representation for searches/exports
    const amount = Number(value);
    let text = String(value);
    if (!isNaN(amount)) {
      try {
        const localCode = getLocalCurrency();
        text = new Intl.NumberFormat(typeof navigator !== "undefined" ? navigator.language : "en-US", {
          style: "currency",
          currency: localCode,
        }).format(amount);
      } catch {
        text = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
      }
    }
    return {
      text,
      muted: false,
      icon: <CurrencyCell value={value} />,
    };
  }
  if (widget === "color") {
    return {
      text: String(value),
      muted: false,
      icon: (
        <span className="flex items-center gap-1.5">
          <span
            className="size-3 rounded-full border border-black/10 shrink-0"
            style={{ backgroundColor: String(value) }}
          />
          <span className="font-mono text-xs">{String(value)}</span>
        </span>
      ),
    };
  }
  if (widget === "url") {
    return {
      text: String(value),
      muted: false,
      icon: (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
          <ExternalLink className="size-3 text-muted-foreground shrink-0" />
        </a>
      ),
    };
  }
  if (widget === "email") {
    return {
      text: String(value),
      muted: false,
      icon: (
        <a
          href={`mailto:${String(value)}`}
          className="inline-flex items-center gap-1 text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
          <Mail className="size-3 text-muted-foreground shrink-0" />
        </a>
      ),
    };
  }
  if (widget === "select" && optionLabels?.[String(value)]) {
    return { text: optionLabels[String(value)], muted: false };
  }
  if (typeof value === "boolean") {
    return {
      text: String(value),
      muted: !value,
      icon: value ? <Check className="size-3.5 text-green-600 dark:text-green-500" /> : <X className="size-3.5 text-muted-foreground" />,
    };
  }
  // MySQL's tinyint(1) (normalized to the "bool" udtName/"toggle" widget)
  // comes back as a raw 0/1 number, not a real JS boolean — trust the widget
  // rather than the runtime type so it still renders as a check/x icon.
  if (widget === "toggle") {
    const truthy = toBoolean(value);
    return {
      text: String(truthy),
      muted: !truthy,
      icon: truthy ? <Check className="size-3.5 text-green-600 dark:text-green-500" /> : <X className="size-3.5 text-muted-foreground" />,
    };
  }
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
