// Data/CRUD service. Identifier safety model: every schema/table/column name
// must exist in the introspected catalog before it is quoted into SQL, and all
// values are parameterized. Writes go through the connection's write role
// inside a transaction and always target exactly one connection.
import { supportsSchemas, type ConnectionConfig, type FkLabels, type TableInfo } from "@/lib/types";
import { vfkMatchesSource, resolveToSchema } from "@/lib/introspect/virtual-fk";
import { fkLabelKey, FK_KEY_SEP } from "@/lib/data/fk-labels";
import { findUpdatedAtColumn, effectiveKey } from "@/lib/introspect/heuristics";
import { getClient, type DbClient } from "@/lib/db/pools";
import { getDialect } from "@/app/api/database/registry";
import type { Dialect } from "@/app/api/database/driver";
import { getConnection, getColumnOverrides, listTableOverrides, listVirtualFks, logAudit } from "@/lib/metadata/store";
import { resolveTableOverride } from "@/lib/introspect/overrides";
import { getConnectionCatalog } from "@/lib/introspect/catalog";
import { guessDisplayColumn } from "@/lib/introspect/heuristics";
import { buildFilterClause, type FilterCondition, type Combinator } from "@/lib/data/filters";
import { matchTargetFor, buildMatchClause } from "@/lib/data/search-match";

export class CrudError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CrudError";
    this.status = status;
  }
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// Back-compat alias — the rich condition type lives in lib/data/filters.
export type Filter = FilterCondition;

export interface ListParams {
  connection: string;
  schema: string | undefined;
  table: string;
  page: number;
  pageSize: number;
  sort?: string;
  sortDir?: "asc" | "desc";
  filters?: FilterCondition[];
  combinator?: Combinator;
  search?: string; // full-text search across text-like columns (only for small tables)
}

// Builds the search WHERE clause for `params.search` — indexed columns only
// (see lib/data/search-match.ts), so there's no row-count gate here anymore:
// unlike a full-column ILIKE scan, an indexed lookup doesn't get slower as
// the table grows.
function searchClauseFor(
  conn: ConnectionConfig,
  table: TableInfo,
  term: string,
  values: unknown[],
  dialect: Dialect,
): string {
  const target = matchTargetFor(table, term, primaryKeyColumnsFor(conn, table));
  if (target.columns.length === 0) return "";
  return buildMatchClause(target, term, values, dialect);
}

async function resolveTable(connectionName: string, schema: string | undefined, table: string) {
  const conn = getConnection(connectionName);
  if (!conn) throw new CrudError(`Unknown connection: ${connectionName}`, 404);
  const catalog = await getConnectionCatalog(conn);
  if (catalog.error) throw new CrudError(`Connection error: ${catalog.error}`, 502);
  const targetSchema = schema || (supportsSchemas(conn.engine) ? "public" : conn.database);
  const sch = catalog.schemas.find((s) => s.name === targetSchema);
  const tbl = sch?.tables.find((t) => t.name === table);
  if (!tbl) throw new CrudError(`Unknown table: ${targetSchema}.${table}`, 404);
  return { conn, table: tbl };
}

function assertColumn(table: TableInfo, column: string): void {
  if (!table.columns.some((c) => c.name === column)) {
    throw new CrudError(`Unknown column: ${column}`);
  }
}

export function displayColumnFor(conn: ConnectionConfig, table: TableInfo): string | null {
  const override = resolveTableOverride(listTableOverrides(), conn.id, table.schema, table.name);
  if (override?.displayColumn && table.columns.some((c) => c.name === override.displayColumn)) {
    return override.displayColumn;
  }
  return guessDisplayColumn(table);
}

// The table's real primary key, or — when introspection found none — the
// "pretend" primary key override (see TableOverride.primaryKey, set on the
// customize page for tables missing a real PK/unique constraint). Search
// treats either as a whole-value identifier: see matchTargetFor.
export function primaryKeyColumnsFor(conn: ConnectionConfig, table: TableInfo): string[] {
  if (table.primaryKey.length > 0) return table.primaryKey;
  const override = resolveTableOverride(listTableOverrides(), conn.id, table.schema, table.name);
  return override?.primaryKey ?? [];
}

// date/timestamp udtNames, normalized identically across engines (see
// dateColumns() in components/browse/view-types.ts, the client-side twin of
// this heuristic).
function isDateLikeUdt(udtName: string): boolean {
  return udtName === "date" || udtName.startsWith("timestamp");
}

// The ORDER BY to use when a request specifies no explicit sort: the
// customize-page "Grid settings" default sort column if one is set, else the
// table's last (highest-ordinal) *indexed* date/timestamp column, descending
// — an unsorted browse is far more often "show me the newest rows" than
// "show me primary-key order" — else null (caller falls back to PK order).
// The auto-pick requires an index: sorting by an unindexed column forces a
// full-table sort on every unsorted browse, which is exactly the silent
// slow-query risk this fallback shouldn't introduce on its own. (The
// admin-configured override above isn't gated on this — that's a deliberate
// per-table choice, not a blanket heuristic applied everywhere.)
function defaultSortFor(conn: ConnectionConfig, table: TableInfo): { column: string; dir: "asc" | "desc" } | null {
  const override = resolveTableOverride(listTableOverrides(), conn.id, table.schema, table.name);
  if (override?.defaultSort && table.columns.some((c) => c.name === override.defaultSort)) {
    return { column: override.defaultSort, dir: override.defaultSortDir ?? "asc" };
  }
  const dateCols = table.columns.filter((c) => isDateLikeUdt(c.udtName) && table.indexedColumns.includes(c.name));
  const lastDateCol = dateCols[dateCols.length - 1];
  return lastDateCol ? { column: lastDateCol.name, dir: "desc" } : null;
}

// The columns to actually SELECT for a grid-type fetch (listRows/
// listGroupedRows) — `hidden`/`hiddenInGrid` columns are dropped so a
// wide-content column (html/markdown/longtext — exactly what hiddenInGrid
// exists for) doesn't get read off disk and shipped over the wire on every
// browse just to be thrown away client-side. `getRow`/`exportRows` are
// deliberately NOT pruned this way: the row editor always needs every
// writable column (hidden or not — see the customize-page hidden-vs-
// hiddenInGrid design notes), and an export is a "give me everything" ask
// independent of grid display prefs.
function selectColumnsFor(conn: ConnectionConfig, table: TableInfo, alwaysInclude: (string | null)[]): string[] {
  const overrides = getColumnOverrides(conn.id, table.schema, table.name);
  const prunable = new Set(overrides.filter((o) => o.hidden || o.hiddenInGrid).map((o) => o.column));
  const keep = new Set(alwaysInclude.filter((c): c is string => !!c));
  return table.columns.filter((c) => keep.has(c.name) || !prunable.has(c.name)).map((c) => c.name);
}

// ---------- list ----------

export async function listRows(params: ListParams) {
  const { conn, table } = await resolveTable(params.connection, params.schema, params.table);
  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");

  try {
    const { tag: tagCols } = widgetOverrideColumns(conn.id, table.schema, table.name);
    const { clause: filterClause, values: filterValues } = buildFilterClause(
      table,
      params.filters ?? [],
      params.combinator ?? "and",
      dialect,
      0,
      tagCols,
    );
    const allValues: unknown[] = [...filterValues];

    const searchClause = params.search ? searchClauseFor(conn, table, params.search, allValues, dialect) : "";

    const clauses = [filterClause, searchClause].filter(Boolean);
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    let orderSql = "";
    const fallbackSort = params.sort ? null : defaultSortFor(conn, table);
    if (params.sort) {
      assertColumn(table, params.sort);
      orderSql = `ORDER BY ${dialect.quoteIdent(params.sort)} ${params.sortDir === "desc" ? "DESC" : "ASC"}`;
      if (dialect.engine === "postgres") {
        orderSql += " NULLS LAST";
      }
    } else if (fallbackSort) {
      orderSql = `ORDER BY ${dialect.quoteIdent(fallbackSort.column)} ${fallbackSort.dir === "desc" ? "DESC" : "ASC"}`;
    } else if (effectiveKey(table).length > 0) {
      orderSql = `ORDER BY ${effectiveKey(table)
        .map((c) => dialect.quoteIdent(c))
        .join(", ")}`;
    }

    const pageSize = Math.min(Math.max(params.pageSize, 1), 200);
    const offset = Math.max(params.page, 0) * pageSize;
    const fqtn = dialect.supportsSchemas
      ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(table.name)}`
      : dialect.quoteIdent(table.name);

    const selectCols = selectColumnsFor(conn, table, [
      ...effectiveKey(table),
      displayColumnFor(conn, table),
      params.sort ?? null,
      fallbackSort?.column ?? null,
    ]);
    const selectSql = selectCols.map((c) => dialect.quoteIdent(c)).join(", ");

    const sql = `SELECT ${selectSql} FROM ${fqtn} ${whereSql} ${orderSql} LIMIT ${pageSize + 1} OFFSET ${offset}`;
    const res = await client.query(sql, allValues);
    const hasMore = res.rows.length > pageSize;
    const rows = hasMore ? res.rows.slice(0, pageSize) : res.rows;
    normalizeTagColumns(rows, tagCols);

    // exact count for small tables, estimate for big ones
    let total: number | null = null;
    if (table.rowEstimate < 100_000) {
      const countRes = await client.query(`SELECT count(*) AS n FROM ${fqtn} ${whereSql}`, allValues);
      total = Number(countRes.rows[0].n);
    } else if (!whereSql) {
      total = table.rowEstimate;
    }

    const fkLabels = await fetchFkLabels(conn, table, rows);
    return { rows, hasMore, total, fkLabels };
  } finally {
    client.release();
  }
}

export interface GroupedListParams {
  connection: string;
  schema: string | undefined;
  table: string;
  groupBy: string;
  groupKind: "value" | "day"; // "day" truncates a date/timestamp column before grouping (calendar)
  perGroup: number; // max rows returned per distinct group
  maxGroups?: number; // max distinct groups fetched at all (default 50) — bounds total rows to maxGroups * perGroup
  sort?: string;
  sortDir?: "asc" | "desc";
  filters?: FilterCondition[];
  combinator?: Combinator;
  search?: string;
}

// Phase 8.4 fix — Kanban/Calendar used to render whatever page the Table view
// had already fetched, bucketed client-side. With one global LIMIT, a group
// (kanban column / calendar day) bigger than the page size crowded every other
// group out of the response entirely. This runs a windowed query so every
// distinct group gets its own top-N, plus an exact per-group count so the UI
// can show "+N more" instead of silently dropping rows.
//
// A group-by column can still have unbounded cardinality (e.g. a high-cardinality
// FK) — total rows fetched is capped at maxGroups * perGroup by first picking
// which distinct groups to show, so a runaway group count can't blow up the
// query the way a runaway group *size* used to.
export async function listGroupedRows(params: GroupedListParams) {
  const { conn, table } = await resolveTable(params.connection, params.schema, params.table);
  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");

  try {
    assertColumn(table, params.groupBy);
    const { tag: tagCols } = widgetOverrideColumns(conn.id, table.schema, table.name);
    const { clause: filterClause, values: filterValues } = buildFilterClause(
      table,
      params.filters ?? [],
      params.combinator ?? "and",
      dialect,
      0,
      tagCols,
    );
    const allValues: unknown[] = [...filterValues];

    const searchClause = params.search ? searchClauseFor(conn, table, params.search, allValues, dialect) : "";

    const clauses = [filterClause, searchClause].filter(Boolean);
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    let orderSql = "";
    const fallbackSort = params.sort ? null : defaultSortFor(conn, table);
    if (params.sort) {
      assertColumn(table, params.sort);
      orderSql = `${dialect.quoteIdent(params.sort)} ${params.sortDir === "desc" ? "DESC" : "ASC"}`;
    } else if (fallbackSort) {
      orderSql = `${dialect.quoteIdent(fallbackSort.column)} ${fallbackSort.dir === "desc" ? "DESC" : "ASC"}`;
    } else if (effectiveKey(table).length > 0) {
      orderSql = effectiveKey(table)
        .map((c) => dialect.quoteIdent(c))
        .join(", ");
    } else {
      orderSql = dialect.quoteIdent(params.groupBy);
    }

    const groupExpr =
      params.groupKind === "day"
        ? dialect.dateTrunc(dialect.quoteIdent(params.groupBy))
        : dialect.quoteIdent(params.groupBy);

    const fqtn = dialect.supportsSchemas
      ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(table.name)}`
      : dialect.quoteIdent(table.name);

    const perGroup = Math.min(Math.max(params.perGroup, 1), 200);
    const maxGroups = Math.min(Math.max(params.maxGroups ?? 50, 1), 200);

    // Step 1 — which distinct groups to show, bounded to maxGroups.
    const distinctSql = `SELECT DISTINCT ${groupExpr} AS __gk FROM ${fqtn} t ${whereSql} ORDER BY ${groupExpr} LIMIT ${maxGroups}`;
    const distinctRes = await client.query(distinctSql, allValues);
    const groupKeys = (distinctRes.rows as { __gk: unknown }[]).map((r) => r.__gk);
    if (groupKeys.length === 0) {
      return { rows: [], groupCounts: {}, fkLabels: {} };
    }
    const nonNullKeys = groupKeys.filter((v) => v != null);
    const hasNullGroup = groupKeys.length > nonNullKeys.length;

    // Restrict both the ranked fetch and the count query to just those
    // groups — NULL can't be matched via `IN`, so it needs its own IS NULL arm.
    const inParts: string[] = [];
    if (nonNullKeys.length > 0) {
      const placeholders = nonNullKeys.map((_, i) => dialect.placeholder(allValues.length + i + 1)).join(", ");
      inParts.push(`${groupExpr} IN (${placeholders})`);
    }
    if (hasNullGroup) inParts.push(`${groupExpr} IS NULL`);
    const groupFilterClause = inParts.length > 1 ? `(${inParts.join(" OR ")})` : inParts[0];
    const scopedWhereSql = whereSql ? `${whereSql} AND ${groupFilterClause}` : `WHERE ${groupFilterClause}`;
    const scopedValues = [...allValues, ...nonNullKeys];

    // Calendar (day grouping) only ever renders a single display field per
    // event chip (see CalendarView/displayValue in table-views.tsx) — unlike
    // kanban cards, which show a handful of extra fields via CardFields — so
    // it doesn't need the rest of the row's non-hidden columns over the wire.
    const selectCols =
      params.groupKind === "day"
        ? [...new Set([...effectiveKey(table), displayColumnFor(conn, table), params.groupBy].filter((c): c is string => !!c))]
        : selectColumnsFor(conn, table, [
            ...effectiveKey(table),
            displayColumnFor(conn, table),
            params.sort ?? null,
            fallbackSort?.column ?? null,
            params.groupBy,
          ]);
    const selectColsSql = selectCols.map((c) => `t.${dialect.quoteIdent(c)}`).join(", ");

    const sql = `
      SELECT * FROM (
        SELECT ${selectColsSql}, ROW_NUMBER() OVER (PARTITION BY ${groupExpr} ORDER BY ${orderSql}) AS __group_rn
        FROM ${fqtn} t ${scopedWhereSql}
      ) __ranked WHERE __group_rn <= ${perGroup}`;
    const res = await client.query(sql, scopedValues);
    const rows = res.rows.map((r) => {
      const { __group_rn: _rn, ...rest } = r as Record<string, unknown>;
      return rest;
    });
    normalizeTagColumns(rows, tagCols);

    // exact row count per shown group, so the UI can flag truncated groups
    // ("+N more") instead of silently dropping rows past `perGroup`.
    const countSql = `SELECT ${groupExpr} AS __group_key, count(*) AS n FROM ${fqtn} t ${scopedWhereSql} GROUP BY ${groupExpr}`;
    const countRes = await client.query(countSql, scopedValues);
    const groupCounts: Record<string, number> = {};
    for (const row of countRes.rows as { __group_key: unknown; n: string | number }[]) {
      const key = row.__group_key == null ? "" : String(row.__group_key);
      groupCounts[key] = Number(row.n);
    }

    // CalendarView (groupKind "day") only renders displayValue(row) — no FK
    // label resolution needed there, unlike kanban cards.
    const fkLabels = params.groupKind === "day" ? {} : await fetchFkLabels(conn, table, rows);
    return { rows, groupCounts, fkLabels };
  } finally {
    client.release();
  }
}

const EXPORT_ROW_LIMIT = 100_000;

// Phase 8.7 — full result set (honoring filters/search/sort) for CSV export.
// Capped so an export can't scan an unbounded table; the cap is reported so
// the caller can warn on truncation.
export async function exportRows(
  params: Omit<ListParams, "page" | "pageSize">,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }> {
  const { conn, table } = await resolveTable(params.connection, params.schema, params.table);
  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");

  try {
    const { tag: tagCols } = widgetOverrideColumns(conn.id, table.schema, table.name);
    const { clause: filterClause, values: filterValues } = buildFilterClause(
      table,
      params.filters ?? [],
      params.combinator ?? "and",
      dialect,
      0,
      tagCols,
    );
    const allValues: unknown[] = [...filterValues];

    const searchClause = params.search ? searchClauseFor(conn, table, params.search, allValues, dialect) : "";

    const clauses = [filterClause, searchClause].filter(Boolean);
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    let orderSql = "";
    if (params.sort) {
      assertColumn(table, params.sort);
      orderSql = `ORDER BY ${dialect.quoteIdent(params.sort)} ${params.sortDir === "desc" ? "DESC" : "ASC"}`;
      if (dialect.engine === "postgres") {
        orderSql += " NULLS LAST";
      }
    } else if (effectiveKey(table).length > 0) {
      orderSql = `ORDER BY ${effectiveKey(table)
        .map((c) => dialect.quoteIdent(c))
        .join(", ")}`;
    }

    const fqtn = dialect.supportsSchemas
      ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(table.name)}`
      : dialect.quoteIdent(table.name);
    const res = await client.query(
      `SELECT * FROM ${fqtn} ${whereSql} ${orderSql} LIMIT ${EXPORT_ROW_LIMIT + 1}`,
      allValues,
    );
    const truncated = res.rows.length > EXPORT_ROW_LIMIT;
    const rows = truncated ? res.rows.slice(0, EXPORT_ROW_LIMIT) : res.rows;
    const columns = res.fields.map((f) => f.name);
    return { columns, rows, truncated };
  } finally {
    client.release();
  }
}

// Phase 8.5 — M2M linked records. A junction table is just a regular table
// with two FK columns, so add/remove go through the existing generic
// createRow/deleteRow on that junction table; this is the one new piece:
// resolving "which other-side rows does this row link to" through the join,
// with a display label so the client doesn't need the other table's metadata.
export async function listLinkedRows(
  connection: string,
  junctionSchema: string | undefined,
  junctionTable: string,
  selfFkColumn: string,
  otherFkColumn: string,
  otherSchema: string | undefined,
  otherTableName: string,
  selfValue: unknown,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const { conn, table: junction } = await resolveTable(connection, junctionSchema, junctionTable);
  assertColumn(junction, selfFkColumn);
  assertColumn(junction, otherFkColumn);

  const catalog = await getConnectionCatalog(conn);
  const resolvedOtherSchema = otherSchema || (supportsSchemas(conn.engine) ? "public" : conn.database);
  const otherTable = catalog.schemas
    .find((s) => s.name === resolvedOtherSchema)
    ?.tables.find((t) => t.name === otherTableName);
  if (!otherTable) throw new CrudError("Unknown target table", 404);
  const otherPk = effectiveKey(otherTable)[0];
  if (!otherPk) throw new CrudError("Target table has no primary key or unique constraint", 400);
  const display = displayColumnFor(conn, otherTable) ?? otherPk;

  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");
  try {
    const fqJunction = dialect.supportsSchemas
      ? `${dialect.quoteIdent(junction.schema)}.${dialect.quoteIdent(junctionTable)}`
      : dialect.quoteIdent(junctionTable);
    const fqOther = dialect.supportsSchemas
      ? `${dialect.quoteIdent(resolvedOtherSchema)}.${dialect.quoteIdent(otherTableName)}`
      : dialect.quoteIdent(otherTableName);

    // Only the projected values are cast to text (the client renders them as
    // labels). The join and the filter compare bare columns so both sides can
    // use their indexes — an FK and the PK it references already share a type.
    const selectDisplay = dialect.castToText(`o.${dialect.quoteIdent(display)}`);
    const selectOtherPk = dialect.castToText(`o.${dialect.quoteIdent(otherPk)}`);
    const joinOnOther = `o.${dialect.quoteIdent(otherPk)}`;
    const joinOnJunction = `j.${dialect.quoteIdent(otherFkColumn)}`;
    const whereSelf = `j.${dialect.quoteIdent(selfFkColumn)}`;

    const LIMIT = 50;

    const countSql = `SELECT COUNT(*) AS __count
                      FROM ${fqJunction} j
                      WHERE ${whereSelf} = ${dialect.placeholder(1)}`;
    const countRes = await client.query(countSql, [selfValue]);
    const total = Number(countRes.rows[0]?.__count ?? 0);

    const sql = `SELECT j.*, ${selectDisplay} AS __label, ${selectOtherPk} AS __other_id
                 FROM ${fqJunction} j
                 JOIN ${fqOther} o
                   ON ${joinOnOther} = ${joinOnJunction}
                 WHERE ${whereSelf} = ${dialect.placeholder(1)}
                 LIMIT ${LIMIT}`;

    const res = await client.query(sql, [selfValue]);
    return { rows: res.rows, total };
  } finally {
    client.release();
  }
}

// Equality against a bound parameter, without wrapping the column in a cast.
// `CAST(id AS CHAR) = ?` (MySQL) and `id::text = $1` (Postgres) are not
// sargable — the planner can't use the column's index and the lookup degrades
// to a full table scan, which is fatal on a large table. Bind the raw value
// instead and let the engine coerce the *parameter* to the column's type.
function equalsParam(columnExpr: string, placeholder: string): string {
  return `${columnExpr} = ${placeholder}`;
}

interface LabelJob {
  displayColumn: string; // source column that receives the labels
  targetConn: ConnectionConfig;
  schema: string; // concrete target schema (after $schema resolution)
  table: string;
  pairs: { from: string; to: string }[];
  constants: { toColumn: string; side?: "source" | "target"; value: string }[];
}

// For each single-column real FK and each matching virtual FK (composite,
// constant-filtered, possibly cross-connection / multi-tenant), resolve the
// target display label for the rows present.
//
// Labels are keyed by the reference column's value *plus* any source-side
// constant (discriminator) columns — see FkLabelSet. A polymorphic relation
// (`subject_id` + `subject_type`) reuses ids across parent tables, so keying by
// `subject_id` alone would hand a Course's title to a Batch row with the same id.
async function fetchFkLabels(
  conn: ConnectionConfig,
  table: TableInfo,
  rows: Record<string, unknown>[],
): Promise<FkLabels> {
  const out: FkLabels = {};
  if (rows.length === 0) return out;

  const jobs: LabelJob[] = [];

  for (const fk of table.foreignKeys) {
    if (fk.columns.length !== 1) continue;
    jobs.push({
      displayColumn: fk.columns[0],
      targetConn: conn,
      schema: fk.referencedSchema,
      table: fk.referencedTable,
      pairs: [{ from: fk.columns[0], to: fk.referencedColumns[0] }],
      constants: [],
    });
  }
  // fromConnection/toConnection store connection ids, not names.
  const vfks = listVirtualFks().filter((v) => vfkMatchesSource(v, conn.id, table.schema, table.name));
  for (const v of vfks) {
    if (v.pairs.length === 0) continue;
    // getConnection accepts either an id or a name, so this needs no change
    // even though v.toConnection is now an id, not a name.
    const target = getConnection(v.toConnection);
    if (!target) continue;
    jobs.push({
      displayColumn: v.pairs[0].from,
      targetConn: target,
      schema: resolveToSchema(v, table.schema),
      table: v.toTable,
      pairs: v.pairs.map((p) => ({ from: p.from, to: p.to })),
      constants: v.constants,
    });
  }

  // Every job writing to the same reference column must agree on the key shape,
  // so the discriminator columns are unioned across jobs up front.
  const keyColumnsFor = new Map<string, string[]>();
  for (const job of jobs) {
    const discriminators = job.constants.filter((c) => c.side === "source").map((c) => c.toColumn);
    const prev = keyColumnsFor.get(job.displayColumn)?.slice(1) ?? [];
    const merged = [...new Set([...prev, ...discriminators])].sort();
    keyColumnsFor.set(job.displayColumn, [job.displayColumn, ...merged]);
  }

  const SEP = FK_KEY_SEP;

  await Promise.all(
    jobs.map(async (job) => {
      try {
        const keyColumns = keyColumnsFor.get(job.displayColumn)!;

        // Join keys for the target lookup, and the row keys each one labels.
        const seen = new Set<string>();
        const tuples: unknown[][] = [];
        const rowKeysByTuple = new Map<string, Set<string>>();
        for (const r of rows) {
          // A source-side constant restricts which rows this relation covers.
          const matchesSourceConstants = job.constants
            .filter((c) => c.side === "source")
            .every((c) => String(r[c.toColumn] ?? "") === c.value);
          if (!matchesSourceConstants) continue;

          const vals = job.pairs.map((p) => r[p.from]);
          if (vals.some((v) => v === null || v === undefined)) continue;
          const tupleKey = vals.map((v) => String(v)).join(SEP);
          let rowKeys = rowKeysByTuple.get(tupleKey);
          if (!rowKeys) {
            rowKeys = new Set();
            rowKeysByTuple.set(tupleKey, rowKeys);
          }
          rowKeys.add(fkLabelKey(r, keyColumns));
          if (!seen.has(tupleKey)) {
            seen.add(tupleKey);
            tuples.push(vals);
          }
        }
        if (tuples.length === 0) return;

        const targetCatalog = await getConnectionCatalog(job.targetConn);
        const targetTable = targetCatalog.schemas
          .find((s) => s.name === job.schema)
          ?.tables.find((t) => t.name === job.table);
        if (!targetTable) return;
        for (const p of job.pairs) if (!targetTable.columns.some((c) => c.name === p.to)) return;
        for (const c of job.constants) {
          if (c.side === "source") {
            if (!table.columns.some((col) => col.name === c.toColumn)) return;
          } else {
            if (!targetTable.columns.some((col) => col.name === c.toColumn)) return;
          }
        }

        const display = displayColumnFor(job.targetConn, targetTable);
        if (!display) return;
        // Nothing to resolve if the label would just echo the id.
        if (job.pairs.length === 1 && display === job.pairs[0].to) return;

        const targetDialect = getDialect(job.targetConn.engine);
        const params: unknown[] = [];
        // Compare the raw column, never a cast of it — a cast is not sargable
        // and turns each label lookup into a full scan.
        const targetExpr = (col: string) => `t.${targetDialect.quoteIdent(col)}`;

        // The keys are an IN filter, not a joined table: every projected value
        // comes from `t` itself, so the keys only ever needed to narrow it.
        //
        // Bind them bare. A parameter compared against a bare column is
        // *coercible* — the engine adopts the column's own type and collation.
        // Wrapping it in a cast (`CAST(? AS CHAR)`) instead gives the value the
        // connection's default collation with implicit coercibility, and MySQL
        // then refuses to compare it against an implicitly-collated column of
        // any other collation: "illegal mix of collations". Which is every
        // utf8mb4_unicode_ci column on a MySQL 8 server, whose connection
        // default is utf8mb4_0900_ai_ci.
        const rowExprs = tuples.map((tuple) => {
          const cols = tuple.map((val) => {
            params.push(val);
            return targetDialect.placeholder(params.length);
          });
          return cols.length === 1 ? cols[0] : `(${cols.join(", ")})`;
        });
        const keyExpr =
          job.pairs.length === 1
            ? targetExpr(job.pairs[0].to)
            : `(${job.pairs.map((p) => targetExpr(p.to)).join(", ")})`;
        const keyClause = `${keyExpr} IN (${rowExprs.join(", ")})`;

        const keyCols = job.pairs.map((_, i) => `k${i}`);
        const selectKeys = job.pairs.map((p, i) => `${targetExpr(p.to)} AS k${i}`);
        const targetConstants = job.constants.filter((c) => !c.side || c.side === "target");
        const constClause = targetConstants.map((c) => {
          params.push(c.value);
          return `${targetExpr(c.toColumn)} = ${targetDialect.placeholder(params.length)}`;
        });
        const where = `WHERE ${[keyClause, ...constClause].join(" AND ")}`;

        const client = await getClient(job.targetConn, "read");
        try {
          const fqTable = targetDialect.supportsSchemas
            ? `${targetDialect.quoteIdent(job.schema)}.${targetDialect.quoteIdent(job.table)}`
            : targetDialect.quoteIdent(job.table);

          const selectDisplay = targetDialect.castToText(`t.${targetDialect.quoteIdent(display)}`);

          const res = await client.query(
            `SELECT ${selectKeys.join(", ")}, ${selectDisplay} AS label
             FROM ${fqTable} t
             ${where}`,
            params,
          );

          const keyToLabel = new Map<string, string>();
          for (const tr of res.rows) {
            keyToLabel.set(keyCols.map((kc) => String(tr[kc])).join(SEP), tr.label as string);
          }

          const labels: Record<string, string> = {};
          for (const [tupleKey, rowKeys] of rowKeysByTuple) {
            const label = keyToLabel.get(tupleKey);
            if (label == null) continue;
            for (const rowKey of rowKeys) labels[rowKey] = label;
          }
          if (Object.keys(labels).length === 0) return;

          // Merge: several relations may label the same column (one per
          // polymorphic type); they share keyColumns so the keys never collide.
          const existing = out[job.displayColumn];
          if (existing) Object.assign(existing.labels, labels);
          else out[job.displayColumn] = { keyColumns, labels };
        } finally {
          client.release();
        }
      } catch {
        /* label resolution is best-effort */
      }
    }),
  );
  return out;
}

// ---------- single row ----------

function pkWhere(table: TableInfo, pk: Record<string, unknown>, values: unknown[], dialect: Dialect): string {
  // Falls back to the first unique constraint when there's no declared
  // primary key — Laravel-style pivot tables (user_id, post_id) commonly
  // have a unique composite index instead of a formal PK. And when a table
  // has NEITHER (some pivot tables only get plain, non-unique indexes on
  // each FK column), fall back further to whatever columns the caller
  // supplied in `pk` — still identifier-validated, just not DB-enforced as
  // unique. Matching every row that happens to share those values is the
  // correct behavior for e.g. an M2M "unlink", which already knows the FK
  // pair is the relationship's real identity regardless of a DB constraint.
  const key = effectiveKey(table);
  if (key.length > 0) {
    const parts = key.map((col) => {
      if (!(col in pk)) throw new CrudError(`Missing key part: ${col}`);
      values.push(pk[col]);
      return equalsParam(dialect.quoteIdent(col), dialect.placeholder(values.length));
    });
    return parts.join(" AND ");
  }
  const cols = Object.keys(pk);
  if (cols.length === 0) throw new CrudError("Table has no primary key or unique constraint; editing is not supported");
  const parts = cols.map((col) => {
    assertColumn(table, col);
    values.push(pk[col]);
    return equalsParam(dialect.quoteIdent(col), dialect.placeholder(values.length));
  });
  return parts.join(" AND ");
}

// Like pkWhere, but for read-only single-row lookups: accepts any validated
// column(s), not just the table's primary key. FK/virtual-FK targets can
// reference any unique column, not necessarily the primary key — requiring
// the full PK here would 404 valid reference lookups. Writes still go through
// the strict pkWhere below; RowEditor re-derives the real PK from the loaded
// row before editing/deleting, so this never weakens mutation safety.
function lookupWhere(table: TableInfo, key: Record<string, unknown>, values: unknown[], dialect: Dialect): string {
  const cols = Object.keys(key);
  if (cols.length === 0) throw new CrudError("No lookup key provided");
  const parts = cols.map((col) => {
    assertColumn(table, col);
    values.push(key[col]);
    return equalsParam(dialect.quoteIdent(col), dialect.placeholder(values.length));
  });
  return parts.join(" AND ");
}

export async function getRow(
  connection: string,
  schema: string | undefined,
  tableName: string,
  pk: Record<string, unknown>,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  const dialect = getDialect(conn.engine);
  const values: unknown[] = [];
  const where = lookupWhere(table, pk, values, dialect);
  const client = await getClient(conn, "read");
  try {
    const fqtn = dialect.supportsSchemas
      ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(tableName)}`
      : dialect.quoteIdent(tableName);
    const res = await client.query(`SELECT * FROM ${fqtn} WHERE ${where}`, values);
    if (res.rows.length === 0) throw new CrudError("Row not found", 404);
    const row = res.rows[0];
    const { tag: tagCols } = widgetOverrideColumns(conn.id, table.schema, tableName);
    normalizeTagColumns([row], tagCols);
    const fkLabels = await fetchFkLabels(conn, table, [row]);
    return { row, fkLabels };
  } finally {
    client.release();
  }
}

// Options for a reference picker: search the referenced table by its display column.
export async function referenceOptions(
  connection: string,
  schema: string | undefined,
  tableName: string,
  refColumn: string,
  search: string,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  assertColumn(table, refColumn);
  const display = displayColumnFor(conn, table) ?? refColumn;
  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");
  try {
    const params: unknown[] = [];
    let where = "";
    if (search) {
      const dispExpr = dialect.castToText(dialect.quoteIdent(display));
      const refExpr = dialect.castToText(dialect.quoteIdent(refColumn));
      // Bind the term once per placeholder. MySQL's `?` is positional, so
      // reusing placeholder(1) for both predicates would leave the second one
      // unbound (Postgres's `$1` can repeat, MySQL's cannot).
      params.push(`%${search}%`);
      const matchDisp = dialect.caseInsensitiveLike(dispExpr, dialect.placeholder(params.length));
      params.push(`%${search}%`);
      const matchRef = dialect.caseInsensitiveLike(refExpr, dialect.placeholder(params.length));
      where = `WHERE ${matchDisp} OR ${matchRef}`;
    }
    const fqtn = dialect.supportsSchemas
      ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(tableName)}`
      : dialect.quoteIdent(tableName);

    const selectId = dialect.castToText(dialect.quoteIdent(refColumn));
    const selectLabel = dialect.castToText(dialect.quoteIdent(display));

    const res = await client.query(
      `SELECT ${selectId} AS id, ${selectLabel} AS label
       FROM ${fqtn} ${where}
       ORDER BY 2 LIMIT 50`,
      params,
    );
    return res.rows as { id: string; label: string }[];
  } finally {
    client.release();
  }
}

// Distinct existing values of a column, for the "autocomplete" widget —
// suggests values already used elsewhere in the table instead of a fixed
// enum. Unlike referenceOptions, the result isn't a constraint: the widget
// still accepts free text, these are just hints to reduce
// typos/near-duplicates (e.g. "New York" vs "new york").
export async function columnSuggestions(
  connection: string,
  schema: string | undefined,
  tableName: string,
  column: string,
  search: string,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  assertColumn(table, column);
  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");
  try {
    const params: unknown[] = [];
    const col = dialect.quoteIdent(column);
    const colExpr = dialect.castToText(col);
    let where = `WHERE ${col} IS NOT NULL`;
    if (search) {
      params.push(`%${search}%`);
      where += ` AND ${dialect.caseInsensitiveLike(colExpr, dialect.placeholder(params.length))}`;
    }
    const fqtn = dialect.supportsSchemas
      ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(tableName)}`
      : dialect.quoteIdent(tableName);

    const res = await client.query(
      `SELECT DISTINCT ${colExpr} AS value FROM ${fqtn} ${where} ORDER BY 1 LIMIT 20`,
      params,
    );
    return (res.rows as { value: string }[]).map((r) => r.value);
  } finally {
    client.release();
  }
}

// ---------- writes ----------

function friendlyDbError(e: unknown, dialect: Dialect): CrudError {
  if (e instanceof CrudError) return e;
  const mapped = dialect.mapError(e);
  if (mapped) {
    return new CrudError(mapped.message, mapped.status);
  }
  return new CrudError(e instanceof Error ? e.message : String(e), 400);
}

function writableColumns(table: TableInfo, data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((k) => {
    const col = table.columns.find((c) => c.name === k);
    return col && !col.isGenerated;
  });
}

function coerceValue(table: TableInfo, column: string, value: unknown, jsonOverrideColumns: Set<string>): unknown {
  if (value === "" || value === undefined) return null;
  const col = table.columns.find((c) => c.name === column);
  if (
    col &&
    (["json", "jsonb"].includes(col.udtName) || jsonOverrideColumns.has(column)) &&
    typeof value === "object" &&
    value !== null
  ) {
    return JSON.stringify(value);
  }
  return value;
}

// One fetch of column overrides, split by widget — avoids callers that need
// more than one widget's columns (e.g. listRows below wants "tag") hitting
// the metadata store separately for each.
//  - json: widget override forces "json" (e.g. a text column storing
//    serialized JSON) — needs the same stringify-before-write treatment as a
//    real json/jsonb column even though its introspected udtName is "text".
//  - tag: widget override is "tag" — the client always treats these as
//    string[], but the raw driver value is a real array only for a genuine
//    json/jsonb column; for plain text/varchar it's the JSON *text*
//    instead. Normalized to string[] on read (see normalizeTagColumns) so
//    every reader can just assume an array.
function widgetOverrideColumns(
  connectionId: string,
  schema: string,
  tableName: string,
): { json: Set<string>; tag: Set<string> } {
  const overrides = getColumnOverrides(connectionId, schema, tableName);
  const json = new Set<string>();
  const tag = new Set<string>();
  for (const o of overrides) {
    if (o.widget === "json") json.add(o.column);
    else if (o.widget === "tag") tag.add(o.column);
  }
  return { json, tag };
}

function normalizeTagValue(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw === "string" && raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      /* not JSON — fall through to empty */
    }
  }
  return [];
}

function normalizeTagColumns(rows: Record<string, unknown>[], cols: Set<string>): void {
  if (cols.size === 0) return;
  for (const row of rows) {
    for (const col of cols) {
      if (col in row) row[col] = normalizeTagValue(row[col]);
    }
  }
}

export async function createRow(
  connection: string,
  schema: string | undefined,
  tableName: string,
  data: Record<string, unknown>,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const dialect = getDialect(conn.engine);
  const cols = writableColumns(table, data);
  if (cols.length === 0) throw new CrudError("No writable columns in payload");
  const { json: jsonCols, tag: tagCols } = widgetOverrideColumns(conn.id, table.schema, tableName);
  // tag columns get the same stringify-if-object treatment as json ones —
  // a real json/jsonb column accepts the array natively; a plain text
  // column needs the JSON text, same as the "json" widget override case.
  const stringifyCols = new Set([...jsonCols, ...tagCols]);
  const values = cols.map((c) => coerceValue(table, c, data[c], stringifyCols));
  const placeholders = cols.map((_, i) => dialect.placeholder(i + 1));
  const fqtn = dialect.supportsSchemas
    ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(tableName)}`
    : dialect.quoteIdent(tableName);

  const returningClause = dialect.supportsReturning ? " RETURNING *" : "";
  const sql = `INSERT INTO ${fqtn} (${cols.map((c) => dialect.quoteIdent(c)).join(", ")})
               VALUES (${placeholders.join(", ")})${returningClause}`;
  const client = await getClient(conn, "write");
  try {
    await client.beginTransaction();
    const res = await client.query(sql, values);
    await client.commit();
    logAudit({
      action: "create",
      sql: `INSERT INTO ${table.schema}.${tableName}`,
      connections: [conn.name],
      rowCount: 1,
    });
    if (dialect.supportsReturning) {
      return res.rows[0];
    } else {
      const pkObj: Record<string, unknown> = {};
      const key = effectiveKey(table);
      if (key.length === 1) {
        const pkCol = key[0];
        pkObj[pkCol] = data[pkCol] ?? res.insertId;
      } else if (key.length > 1) {
        for (const pkCol of key) {
          pkObj[pkCol] = data[pkCol];
        }
      } else {
        // No PK or unique constraint (e.g. a Laravel-style pivot table with
        // only plain, non-unique indexes) — fall back to matching on every
        // column the caller actually inserted, which for a junction-table
        // link is exactly the FK pair, its real identity regardless of a
        // DB constraint.
        for (const col of Object.keys(data)) {
          pkObj[col] = data[col];
        }
      }
      const { row } = await getRow(connection, schema, tableName, pkObj);
      return row;
    }
  } catch (e) {
    await client.rollback().catch(() => {});
    throw friendlyDbError(e, dialect);
  } finally {
    client.release();
  }
}

const IMPORT_ROW_LIMIT = 5000;

// Phase 8.7 — CSV import. Each row inserts in its own SAVEPOINT so one bad
// row (a failed constraint, a bad type) doesn't abort the whole batch —
// import what's valid, report exactly which rows and why weren't.
export async function bulkInsertRows(
  connection: string,
  schema: string | undefined,
  tableName: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number; errors: { row: number; message: string }[] }> {
  if (rows.length === 0) return { inserted: 0, errors: [] };
  if (rows.length > IMPORT_ROW_LIMIT) {
    throw new CrudError(`Import is capped at ${IMPORT_ROW_LIMIT} rows per request`);
  }
  const { conn, table } = await resolveTable(connection, schema, tableName);
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const dialect = getDialect(conn.engine);
  const fqtn = dialect.supportsSchemas
    ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(tableName)}`
    : dialect.quoteIdent(tableName);

  const { json: jsonCols, tag: tagCols } = widgetOverrideColumns(conn.id, table.schema, tableName);
  // tag columns get the same stringify-if-object treatment as json ones —
  // a real json/jsonb column accepts the array natively; a plain text
  // column needs the JSON text, same as the "json" widget override case.
  const stringifyCols = new Set([...jsonCols, ...tagCols]);
  const client = await getClient(conn, "write");
  let inserted = 0;
  const errors: { row: number; message: string }[] = [];
  try {
    await client.beginTransaction();
    for (let i = 0; i < rows.length; i++) {
      const cols = writableColumns(table, rows[i]);
      if (cols.length === 0) {
        errors.push({ row: i, message: "No writable columns" });
        continue;
      }
      const values = cols.map((c) => coerceValue(table, c, rows[i][c], stringifyCols));
      const placeholders = cols.map((_, j) => dialect.placeholder(j + 1));
      await client.query("SAVEPOINT import_row");
      try {
        await client.query(
          `INSERT INTO ${fqtn} (${cols.map((c) => dialect.quoteIdent(c)).join(", ")}) VALUES (${placeholders.join(", ")})`,
          values,
        );
        await client.query("RELEASE SAVEPOINT import_row");
        inserted++;
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT import_row");
        errors.push({ row: i, message: friendlyDbError(e, dialect).message });
      }
    }
    await client.commit();
    logAudit({
      action: "import",
      sql: `INSERT INTO ${table.schema}.${tableName} (bulk, ${inserted} rows)`,
      connections: [conn.name],
      rowCount: inserted,
    });
    return { inserted, errors };
  } catch (e) {
    await client.rollback().catch(() => {});
    throw friendlyDbError(e, dialect);
  } finally {
    client.release();
  }
}

export async function updateRow(
  connection: string,
  schema: string | undefined,
  tableName: string,
  pk: Record<string, unknown>,
  data: Record<string, unknown>,
  expectedUpdatedAt?: string,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const dialect = getDialect(conn.engine);
  const key = effectiveKey(table);
  const cols = writableColumns(table, data).filter((c) => !key.includes(c));
  if (cols.length === 0) throw new CrudError("No writable columns in payload");
  const { json: jsonCols, tag: tagCols } = widgetOverrideColumns(conn.id, table.schema, tableName);
  // tag columns get the same stringify-if-object treatment as json ones —
  // a real json/jsonb column accepts the array natively; a plain text
  // column needs the JSON text, same as the "json" widget override case.
  const stringifyCols = new Set([...jsonCols, ...tagCols]);
  const values: unknown[] = cols.map((c) => coerceValue(table, c, data[c], stringifyCols));
  const sets = cols.map((c, i) => `${dialect.quoteIdent(c)} = ${dialect.placeholder(i + 1)}`);
  let where = pkWhere(table, pk, values, dialect);
  // optimistic concurrency when the table has a recognisable timestamp column
  const updatedAtCol = findUpdatedAtColumn(table.columns);
  if (expectedUpdatedAt && updatedAtCol) {
    values.push(expectedUpdatedAt);
    if (dialect.engine === "postgres") {
      where += ` AND date_trunc('milliseconds', ${dialect.quoteIdent(updatedAtCol)}::timestamptz) = date_trunc('milliseconds', ${dialect.placeholder(values.length)}::timestamptz)`;
    } else if (dialect.engine === "mysql") {
      where += ` AND CAST(${dialect.quoteIdent(updatedAtCol)} AS DATETIME(3)) = CAST(${dialect.placeholder(values.length)} AS DATETIME(3))`;
    }
  }
  const fqtn = dialect.supportsSchemas
    ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(tableName)}`
    : dialect.quoteIdent(tableName);

  const returningClause = dialect.supportsReturning ? " RETURNING *" : "";
  const sql = `UPDATE ${fqtn} SET ${sets.join(", ")} WHERE ${where}${returningClause}`;
  const client = await getClient(conn, "write");
  try {
    await client.beginTransaction();
    const res = await client.query(sql, values);
    await client.commit();
    if (res.rowCount === 0) {
      throw new CrudError(
        expectedUpdatedAt
          ? "Row was modified by someone else since you loaded it (or no longer exists)"
          : "Row not found",
        409,
      );
    }
    logAudit({
      action: "update",
      sql: `UPDATE ${table.schema}.${tableName}`,
      connections: [conn.name],
      rowCount: 1,
    });
    if (dialect.supportsReturning) {
      return res.rows[0];
    } else {
      const { row } = await getRow(connection, schema, tableName, pk);
      return row;
    }
  } catch (e) {
    await client.rollback().catch(() => {});
    if (e instanceof CrudError) throw e;
    throw friendlyDbError(e, dialect);
  } finally {
    client.release();
  }
}

export async function deleteRow(
  connection: string,
  schema: string | undefined,
  tableName: string,
  pk: Record<string, unknown>,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const dialect = getDialect(conn.engine);
  const values: unknown[] = [];
  const where = pkWhere(table, pk, values, dialect);
  const fqtn = dialect.supportsSchemas
    ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(tableName)}`
    : dialect.quoteIdent(tableName);

  const sql = `DELETE FROM ${fqtn} WHERE ${where}`;
  const client = await getClient(conn, "write");
  try {
    await client.beginTransaction();
    const res = await client.query(sql, values);
    await client.commit();
    if (res.rowCount === 0) throw new CrudError("Row not found", 404);
    logAudit({
      action: "delete",
      sql: `DELETE FROM ${table.schema}.${tableName}`,
      connections: [conn.name],
      rowCount: res.rowCount,
    });
    return { deleted: res.rowCount };
  } catch (e) {
    await client.rollback().catch(() => {});
    if (e instanceof CrudError) throw e;
    throw friendlyDbError(e, dialect);
  } finally {
    client.release();
  }
}

// Unique tag values for the "tag" widget, whose column stores a JSON array
// per row (row A: '["red","blue"]', row B: '["blue","green"]'). A plain
// `SELECT DISTINCT` would only dedupe whole-array strings, not the
// individual tags within them, so this flattens every row's array and
// dedupes across rows in code instead — sidesteps needing per-engine
// JSON-unnesting SQL (Postgres jsonb_array_elements_text vs MySQL
// JSON_TABLE) for what's fundamentally a small autocomplete list.
export async function distinctColumnValues(
  connection: string,
  schema: string | undefined,
  tableName: string,
  columnName: string,
  search: string,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  assertColumn(table, columnName);
  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");
  try {
    const fqtn = dialect.supportsSchemas
      ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(tableName)}`
      : dialect.quoteIdent(tableName);

    const res = await client.query(
      `SELECT ${dialect.quoteIdent(columnName)} AS value FROM ${fqtn}
       WHERE ${dialect.quoteIdent(columnName)} IS NOT NULL LIMIT 500`,
      [],
    );
    const seen = new Set<string>();
    for (const row of res.rows as { value: unknown }[]) {
      let arr: unknown;
      try {
        arr = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
      } catch {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (typeof item === "string" && item) seen.add(item);
      }
    }
    const q = search.toLowerCase();
    return [...seen]
      .filter((v) => !q || v.toLowerCase().includes(q))
      .sort()
      .slice(0, 50);
  } finally {
    client.release();
  }
}
