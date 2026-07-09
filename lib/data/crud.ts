// Data/CRUD service. Identifier safety model: every schema/table/column name
// must exist in the introspected catalog before it is quoted into SQL, and all
// values are parameterized. Writes go through the connection's write role
// inside a transaction and always target exactly one connection.
import { supportsSchemas, type ConnectionConfig, type TableInfo, type VfkTransform } from "@/lib/types";
import {
  vfkMatchesSource,
  resolveToSchema,
  applyTransform,
} from "@/lib/introspect/virtual-fk";
import { findUpdatedAtColumn } from "@/lib/introspect/heuristics";
import { getClient, type DbClient } from "@/lib/db/pools";
import { getDialect } from "@/app/api/database/registry";
import type { Dialect } from "@/app/api/database/driver";
import {
  getConnection,
  getColumnOverrides,
  listTableOverrides,
  listVirtualFks,
  logAudit,
} from "@/lib/metadata/store";
import { resolveTableOverride } from "@/lib/introspect/overrides";
import { getConnectionCatalog } from "@/lib/introspect/catalog";
import { guessDisplayColumn } from "@/lib/introspect/heuristics";
import {
  buildFilterClause,
  type FilterCondition,
  type Combinator,
} from "@/lib/data/filters";

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

const TEXT_LIKE_TYPES = new Set([
  "text",
  "varchar",
  "bpchar",
  "citext",
  "name",
  "char",
]);
const SEARCH_ROW_LIMIT = 500_000;

async function resolveTable(
  connectionName: string,
  schema: string | undefined,
  table: string,
) {
  const conn = getConnection(connectionName);
  if (!conn) throw new CrudError(`Unknown connection: ${connectionName}`, 404);
  const catalog = await getConnectionCatalog(conn);
  if (catalog.error)
    throw new CrudError(`Connection error: ${catalog.error}`, 502);
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

function displayColumnFor(
  conn: ConnectionConfig,
  table: TableInfo,
): string | null {
  const override = resolveTableOverride(
    listTableOverrides(),
    conn.id,
    table.schema,
    table.name,
  );
  if (
    override?.displayColumn &&
    table.columns.some((c) => c.name === override.displayColumn)
  ) {
    return override.displayColumn;
  }
  return guessDisplayColumn(table);
}

// ---------- list ----------

export async function listRows(params: ListParams) {
  const { conn, table } = await resolveTable(
    params.connection,
    params.schema,
    params.table,
  );
  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");

  try {
    const { clause: filterClause, values: filterValues } = buildFilterClause(
      table,
      params.filters ?? [],
      params.combinator ?? "and",
      dialect,
    );
    const allValues: unknown[] = [...filterValues];

    let searchClause = "";
    if (params.search && table.rowEstimate < SEARCH_ROW_LIMIT) {
      const term = params.search.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const textCols = table.columns.filter((c) =>
        TEXT_LIKE_TYPES.has(c.udtName),
      );
      if (textCols.length > 0) {
        const idx = allValues.length + 1;
        allValues.push(`%${term}%`);
        searchClause = `(${textCols.map((c) => dialect.caseInsensitiveLike(dialect.quoteIdent(c.name), dialect.placeholder(idx))).join(" OR ")})`;
      }
    }

    const clauses = [filterClause, searchClause].filter(Boolean);
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    let orderSql = "";
    if (params.sort) {
      assertColumn(table, params.sort);
      orderSql = `ORDER BY ${dialect.quoteIdent(params.sort)} ${params.sortDir === "desc" ? "DESC" : "ASC"}`;
      if (dialect.engine === "postgres") {
        orderSql += " NULLS LAST";
      }
    } else if (table.primaryKey.length > 0) {
      orderSql = `ORDER BY ${table.primaryKey.map((c) => dialect.quoteIdent(c)).join(", ")}`;
    }

    const pageSize = Math.min(Math.max(params.pageSize, 1), 200);
    const offset = Math.max(params.page, 0) * pageSize;
    const fqtn = dialect.supportsSchemas
      ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(table.name)}`
      : dialect.quoteIdent(table.name);

    const sql = `SELECT * FROM ${fqtn} ${whereSql} ${orderSql} LIMIT ${pageSize + 1} OFFSET ${offset}`;
    const res = await client.query(sql, allValues);
    const hasMore = res.rows.length > pageSize;
    const rows = hasMore ? res.rows.slice(0, pageSize) : res.rows;

    // exact count for small tables, estimate for big ones
    let total: number | null = null;
    if (table.rowEstimate < 100_000) {
      const countRes = await client.query(
        `SELECT count(*) AS n FROM ${fqtn} ${whereSql}`,
        allValues,
      );
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

const EXPORT_ROW_LIMIT = 100_000;

// Phase 8.7 — full result set (honoring filters/search/sort) for CSV export.
// Capped so an export can't scan an unbounded table; the cap is reported so
// the caller can warn on truncation.
export async function exportRows(
  params: Omit<ListParams, "page" | "pageSize">,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }> {
  const { conn, table } = await resolveTable(
    params.connection,
    params.schema,
    params.table,
  );
  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");

  try {
    const { clause: filterClause, values: filterValues } = buildFilterClause(
      table,
      params.filters ?? [],
      params.combinator ?? "and",
      dialect,
    );
    const allValues: unknown[] = [...filterValues];

    let searchClause = "";
    if (params.search && table.rowEstimate < SEARCH_ROW_LIMIT) {
      const term = params.search.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const textCols = table.columns.filter((c) =>
        TEXT_LIKE_TYPES.has(c.udtName),
      );
      if (textCols.length > 0) {
        const idx = allValues.length + 1;
        allValues.push(`%${term}%`);
        searchClause = `(${textCols.map((c) => dialect.caseInsensitiveLike(dialect.quoteIdent(c.name), dialect.placeholder(idx))).join(" OR ")})`;
      }
    }

    const clauses = [filterClause, searchClause].filter(Boolean);
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    let orderSql = "";
    if (params.sort) {
      assertColumn(table, params.sort);
      orderSql = `ORDER BY ${dialect.quoteIdent(params.sort)} ${params.sortDir === "desc" ? "DESC" : "ASC"}`;
      if (dialect.engine === "postgres") {
        orderSql += " NULLS LAST";
      }
    } else if (table.primaryKey.length > 0) {
      orderSql = `ORDER BY ${table.primaryKey.map((c) => dialect.quoteIdent(c)).join(", ")}`;
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
): Promise<Record<string, unknown>[]> {
  const { conn, table: junction } = await resolveTable(
    connection,
    junctionSchema,
    junctionTable,
  );
  assertColumn(junction, selfFkColumn);
  assertColumn(junction, otherFkColumn);

  const catalog = await getConnectionCatalog(conn);
  const resolvedOtherSchema = otherSchema || (supportsSchemas(conn.engine) ? "public" : conn.database);
  const otherTable = catalog.schemas
    .find((s) => s.name === resolvedOtherSchema)
    ?.tables.find((t) => t.name === otherTableName);
  if (!otherTable) throw new CrudError("Unknown target table", 404);
  const otherPk = otherTable.primaryKey[0];
  if (!otherPk) throw new CrudError("Target table has no primary key", 400);
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

    const selectDisplay = dialect.castToText(`o.${dialect.quoteIdent(display)}`);
    const selectOtherPk = dialect.castToText(`o.${dialect.quoteIdent(otherPk)}`);
    const joinOnOther = dialect.castToText(`o.${dialect.quoteIdent(otherPk)}`);
    const joinOnJunction = dialect.castToText(`j.${dialect.quoteIdent(otherFkColumn)}`);
    const whereSelf = dialect.castToText(`j.${dialect.quoteIdent(selfFkColumn)}`);

    const sql = `SELECT j.*, ${selectDisplay} AS __label, ${selectOtherPk} AS __other_id
                 FROM ${fqJunction} j
                 JOIN ${fqOther} o
                   ON ${joinOnOther} = ${joinOnJunction}
                 WHERE ${whereSelf} = ${dialect.placeholder(1)}`;

    const res = await client.query(sql, [String(selfValue)]);
    return res.rows;
  } finally {
    client.release();
  }
}

function transformSql(expr: string, t: VfkTransform): string {
  switch (t) {
    case "lower":
      return `LOWER(${expr})`;
    case "upper":
      return `UPPER(${expr})`;
    case "trim":
      return `TRIM(${expr})`;
    default:
      return expr;
  }
}

interface LabelJob {
  displayColumn: string; // source column that receives the labels
  targetConn: ConnectionConfig;
  schema: string; // concrete target schema (after $schema resolution)
  table: string;
  pairs: { from: string; to: string; transform: VfkTransform }[];
  constants: { toColumn: string; value: string }[];
}

// For each single-column real FK and each matching virtual FK (composite,
// transformed, constant-filtered, possibly cross-connection / multi-tenant),
// resolve the target display label for the rows present. Returns
// { [displayColumn]: { [rawSourceValue]: label } } — keyed by the raw value of
// the display column so the grid's `fkLabels[col][String(v)]` lookup hits
// regardless of composite arity or case/whitespace transforms.
async function fetchFkLabels(
  conn: ConnectionConfig,
  table: TableInfo,
  rows: Record<string, unknown>[],
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  if (rows.length === 0) return out;

  const jobs: LabelJob[] = [];

  for (const fk of table.foreignKeys) {
    if (fk.columns.length !== 1) continue;
    jobs.push({
      displayColumn: fk.columns[0],
      targetConn: conn,
      schema: fk.referencedSchema,
      table: fk.referencedTable,
      pairs: [
        { from: fk.columns[0], to: fk.referencedColumns[0], transform: "none" },
      ],
      constants: [],
    });
  }
  const vfks = listVirtualFks().filter((v) =>
    vfkMatchesSource(v, conn.name, table.schema, table.name),
  );
  for (const v of vfks) {
    if (v.pairs.length === 0) continue;
    const target = getConnection(v.toConnection);
    if (!target) continue;
    jobs.push({
      displayColumn: v.pairs[0].from,
      targetConn: target,
      schema: resolveToSchema(v, table.schema),
      table: v.toTable,
      pairs: v.pairs.map((p) => ({
        from: p.from,
        to: p.to,
        transform: p.transform ?? "none",
      })),
      constants: v.constants,
    });
  }

  const SEP = " ";

  await Promise.all(
    jobs.map(async (job) => {
      try {
        // Build normalized source tuples and remember the raw display value
        // each tuple maps to (last write wins on collision — best effort).
        const seen = new Set<string>();
        const tuples: string[][] = [];
        const rawByKey = new Map<string, string>();
        for (const r of rows) {
          const vals = job.pairs.map((p) => r[p.from]);
          if (vals.some((v) => v === null || v === undefined)) continue;
          const norm = job.pairs.map((p, i) => applyTransform(vals[i], p.transform));
          const key = norm.join(SEP);
          rawByKey.set(key, String(r[job.displayColumn]));
          if (!seen.has(key)) {
            seen.add(key);
            tuples.push(norm);
          }
        }
        if (tuples.length === 0) return;

        const targetCatalog = await getConnectionCatalog(job.targetConn);
        const targetTable = targetCatalog.schemas
          .find((s) => s.name === job.schema)
          ?.tables.find((t) => t.name === job.table);
        if (!targetTable) return;
        for (const p of job.pairs)
          if (!targetTable.columns.some((c) => c.name === p.to)) return;
        for (const c of job.constants)
          if (!targetTable.columns.some((col) => col.name === c.toColumn)) return;

        const display = displayColumnFor(job.targetConn, targetTable);
        if (!display) return;
        // Nothing to resolve if the label would just echo the id.
        if (job.pairs.length === 1 && display === job.pairs[0].to) return;

        const targetDialect = getDialect(job.targetConn.engine);
        const params: unknown[] = [];
        const targetExpr = (col: string, t: VfkTransform) =>
          transformSql(targetDialect.castToText(`t.${targetDialect.quoteIdent(col)}`), t);

        const valuesRows = tuples.map((tuple, rowIndex) => {
          const cols = tuple.map((val, colIndex) => {
            params.push(val);
            const placeholder = targetDialect.placeholder(params.length);
            return rowIndex === 0 ? `${placeholder} AS k${colIndex}` : placeholder;
          });
          return `SELECT ${cols.join(", ")}`;
        });
        const keysSubquery = `(${valuesRows.join(" UNION ALL ")})`;

        const keyCols = job.pairs.map((_, i) => `k${i}`);
        const onClause = job.pairs
          .map((p, i) => `${targetExpr(p.to, p.transform)} = keys.k${i}`)
          .join(" AND ");
        const selectKeys = job.pairs.map(
          (p, i) => `${targetExpr(p.to, p.transform)} AS k${i}`,
        );
        const constClause = job.constants.map((c) => {
          params.push(c.value);
          return `${targetDialect.castToText(`t.${targetDialect.quoteIdent(c.toColumn)}`)} = ${targetDialect.placeholder(params.length)}`;
        });
        const where = constClause.length
          ? `WHERE ${constClause.join(" AND ")}`
          : "";

        const client = await getClient(job.targetConn, "read");
        try {
          const fqTable = targetDialect.supportsSchemas
            ? `${targetDialect.quoteIdent(job.schema)}.${targetDialect.quoteIdent(job.table)}`
            : targetDialect.quoteIdent(job.table);

          const selectDisplay = targetDialect.castToText(`t.${targetDialect.quoteIdent(display)}`);

          const res = await client.query(
            `SELECT ${selectKeys.join(", ")}, ${selectDisplay} AS label
             FROM ${fqTable} t
             JOIN ${keysSubquery} keys
               ON ${onClause}
             ${where}`,
            params,
          );

          const keyToLabel = new Map<string, string>();
          for (const tr of res.rows) {
            keyToLabel.set(keyCols.map((kc) => tr[kc]).join(SEP), tr.label);
          }
          const map: Record<string, string> = {};
          for (const [tupleKey, rawVal] of rawByKey) {
            const label = keyToLabel.get(tupleKey);
            if (label != null) map[rawVal] = label;
          }
          if (Object.keys(map).length) out[job.displayColumn] = map;
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

function pkWhere(
  table: TableInfo,
  pk: Record<string, unknown>,
  values: unknown[],
  dialect: Dialect,
): string {
  if (table.primaryKey.length === 0)
    throw new CrudError("Table has no primary key; editing is not supported");
  const parts = table.primaryKey.map((col) => {
    if (!(col in pk)) throw new CrudError(`Missing primary key part: ${col}`);
    values.push((pk[col]));
    return `${dialect.castToText(dialect.quoteIdent(col))} = ${dialect.placeholder(values.length)}`;
  });
  return parts.join(" AND ");
}

// Like pkWhere, but for read-only single-row lookups: accepts any validated
// column(s), not just the table's primary key. FK/virtual-FK targets can
// reference any unique column, not necessarily the primary key — requiring
// the full PK here would 404 valid reference lookups. Writes still go through
// the strict pkWhere below; RowEditor re-derives the real PK from the loaded
// row before editing/deleting, so this never weakens mutation safety.
// `keyTransforms` mirrors a virtual FK pair's value transform (see
// fetchFkLabels) so a case-insensitive/trimmed join can still be looked up
// one row at a time — without it, a lookup on a transformed reference column
// would silently 404 (exact match against a value that only matches modulo
// case/whitespace).
function lookupWhere(
  table: TableInfo,
  key: Record<string, unknown>,
  values: unknown[],
  dialect: Dialect,
  keyTransforms: Record<string, VfkTransform> = {},
): string {
  const cols = Object.keys(key);
  if (cols.length === 0) throw new CrudError("No lookup key provided");
  const parts = cols.map((col) => {
    assertColumn(table, col);
    const t = keyTransforms[col] ?? "none";
    values.push(applyTransform(key[col], t));
    const expr = dialect.castToText(dialect.quoteIdent(col));
    return `${transformSql(expr, t)} = ${dialect.placeholder(values.length)}`;
  });
  return parts.join(" AND ");
}

export async function getRow(
  connection: string,
  schema: string | undefined,
  tableName: string,
  pk: Record<string, unknown>,
  keyTransforms?: Record<string, VfkTransform>,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  const dialect = getDialect(conn.engine);
  const values: unknown[] = [];
  const where = lookupWhere(table, pk, values, dialect, keyTransforms);
  const client = await getClient(conn, "read");
  try {
    const fqtn = dialect.supportsSchemas
      ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(tableName)}`
      : dialect.quoteIdent(tableName);
    const res = await client.query(
      `SELECT * FROM ${fqtn} WHERE ${where}`,
      values,
    );
    if (res.rows.length === 0) throw new CrudError("Row not found", 404);
    const row = res.rows[0];
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
      params.push(`%${search}%`);
      const dispExpr = dialect.castToText(dialect.quoteIdent(display));
      const refExpr = dialect.castToText(dialect.quoteIdent(refColumn));
      const matchDisp = dialect.caseInsensitiveLike(dispExpr, dialect.placeholder(1));
      const matchRef = dialect.caseInsensitiveLike(refExpr, dialect.placeholder(1));
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

// ---------- writes ----------

function friendlyDbError(e: unknown, dialect: Dialect): CrudError {
  if (e instanceof CrudError) return e;
  const mapped = dialect.mapError(e);
  if (mapped) {
    return new CrudError(mapped.message, mapped.status);
  }
  return new CrudError(e instanceof Error ? e.message : String(e), 400);
}

function writableColumns(
  table: TableInfo,
  data: Record<string, unknown>,
): string[] {
  return Object.keys(data).filter((k) => {
    const col = table.columns.find((c) => c.name === k);
    return col && !col.isGenerated;
  });
}

function coerceValue(
  table: TableInfo,
  column: string,
  value: unknown,
  jsonOverrideColumns: Set<string>,
): unknown {
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

// Columns whose widget override forces "json" — e.g. a text column storing
// serialized JSON. These need the same stringify-before-write treatment as a
// real json/jsonb column even though their introspected udtName is "text".
function jsonOverrideColumns(
  connectionId: string,
  schema: string,
  tableName: string,
): Set<string> {
  return new Set(
    getColumnOverrides(connectionId, schema, tableName)
      .filter((o) => o.widget === "json")
      .map((o) => o.column),
  );
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
  const jsonCols = jsonOverrideColumns(conn.id, table.schema, tableName);
  const values = cols.map((c) => coerceValue(table, c, data[c], jsonCols));
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
      if (table.primaryKey.length === 1) {
        const pkCol = table.primaryKey[0];
        pkObj[pkCol] = data[pkCol] ?? res.insertId;
      } else {
        for (const pkCol of table.primaryKey) {
          pkObj[pkCol] = data[pkCol];
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

  const jsonCols = jsonOverrideColumns(conn.id, table.schema, tableName);
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
      const values = cols.map((c) => coerceValue(table, c, rows[i][c], jsonCols));
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
  const cols = writableColumns(table, data).filter(
    (c) => !table.primaryKey.includes(c),
  );
  if (cols.length === 0) throw new CrudError("No writable columns in payload");
  const jsonCols = jsonOverrideColumns(conn.id, table.schema, tableName);
  const values: unknown[] = cols.map((c) => coerceValue(table, c, data[c], jsonCols));
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
