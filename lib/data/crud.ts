// Data/CRUD service. Identifier safety model: every schema/table/column name
// must exist in the introspected catalog before it is quoted into SQL, and all
// values are parameterized. Writes go through the connection's write role
// inside a transaction and always target exactly one connection.
import type { ConnectionConfig, TableInfo, VirtualFk } from "@/lib/types";
import { getPool } from "@/lib/db/pools";
import {
  getConnection,
  getTableOverride,
  listVirtualFks,
  logAudit,
} from "@/lib/metadata/store";
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
  schema: string;
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
  schema: string,
  table: string,
) {
  const conn = getConnection(connectionName);
  if (!conn) throw new CrudError(`Unknown connection: ${connectionName}`, 404);
  const catalog = await getConnectionCatalog(conn);
  if (catalog.error)
    throw new CrudError(`Connection error: ${catalog.error}`, 502);
  const sch = catalog.schemas.find((s) => s.name === schema);
  const tbl = sch?.tables.find((t) => t.name === table);
  if (!tbl) throw new CrudError(`Unknown table: ${schema}.${table}`, 404);
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
  const override = getTableOverride(conn.id, table.schema, table.name);
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
  const pool = getPool(conn, "read");

  const { clause: filterClause, values: filterValues } = buildFilterClause(
    table,
    params.filters ?? [],
    params.combinator ?? "and",
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
      searchClause = `(${textCols.map((c) => `${quoteIdent(c.name)} ILIKE $${idx}`).join(" OR ")})`;
    }
  }

  const clauses = [filterClause, searchClause].filter(Boolean);
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  let orderSql = "";
  if (params.sort) {
    assertColumn(table, params.sort);
    orderSql = `ORDER BY ${quoteIdent(params.sort)} ${params.sortDir === "desc" ? "DESC" : "ASC"} NULLS LAST`;
  } else if (table.primaryKey.length > 0) {
    orderSql = `ORDER BY ${table.primaryKey.map(quoteIdent).join(", ")}`;
  }

  const pageSize = Math.min(Math.max(params.pageSize, 1), 200);
  const offset = Math.max(params.page, 0) * pageSize;
  const fqtn = `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;

  const sql = `SELECT * FROM ${fqtn} ${whereSql} ${orderSql} LIMIT ${pageSize + 1} OFFSET ${offset}`;
  const res = await pool.query(sql, allValues);
  const hasMore = res.rows.length > pageSize;
  const rows = hasMore ? res.rows.slice(0, pageSize) : res.rows;

  // exact count for small tables, estimate for big ones
  let total: number | null = null;
  if (table.rowEstimate < 100_000) {
    const countRes = await pool.query(
      `SELECT count(*)::bigint AS n FROM ${fqtn} ${whereSql}`,
      allValues,
    );
    total = Number(countRes.rows[0].n);
  } else if (!whereSql) {
    total = table.rowEstimate;
  }

  const fkLabels = await fetchFkLabels(conn, table, rows);
  return { rows, hasMore, total, fkLabels };
}

// For each single-column FK (real, same connection) and virtual FK (possibly
// cross-connection), resolve id → display label for the ids present in `rows`.
// Returns { [columnName]: { [id]: label } }.
async function fetchFkLabels(
  conn: ConnectionConfig,
  table: TableInfo,
  rows: Record<string, unknown>[],
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  if (rows.length === 0) return out;

  const jobs: {
    column: string;
    targetConn: ConnectionConfig;
    schema: string;
    table: string;
    refColumn: string;
  }[] = [];

  for (const fk of table.foreignKeys) {
    if (fk.columns.length !== 1) continue;
    jobs.push({
      column: fk.columns[0],
      targetConn: conn,
      schema: fk.referencedSchema,
      table: fk.referencedTable,
      refColumn: fk.referencedColumns[0],
    });
  }
  const vfks = listVirtualFks().filter(
    (v) =>
      v.fromConnection === conn.name &&
      v.fromSchema === table.schema &&
      v.fromTable === table.name,
  );
  for (const v of vfks) {
    const target = getConnection(v.toConnection);
    if (!target) continue;
    jobs.push({
      column: v.fromColumn,
      targetConn: target,
      schema: v.toSchema,
      table: v.toTable,
      refColumn: v.toColumn,
    });
  }

  await Promise.all(
    jobs.map(async (job) => {
      try {
        const ids = [
          ...new Set(
            rows
              .map((r) => r[job.column])
              .filter((v) => v !== null && v !== undefined),
          ),
        ];
        if (ids.length === 0) return;
        const targetCatalog = await getConnectionCatalog(job.targetConn);
        const targetTable = targetCatalog.schemas
          .find((s) => s.name === job.schema)
          ?.tables.find((t) => t.name === job.table);
        if (!targetTable) return;
        const display = displayColumnFor(job.targetConn, targetTable);
        if (!display || display === job.refColumn) return;
        const pool = getPool(job.targetConn, "read");
        const res = await pool.query(
          `SELECT ${quoteIdent(job.refColumn)}::text AS id, ${quoteIdent(display)}::text AS label
           FROM ${quoteIdent(job.schema)}.${quoteIdent(job.table)}
           WHERE ${quoteIdent(job.refColumn)}::text = ANY($1)`,
          [ids.map(String)],
        );
        const map: Record<string, string> = {};
        for (const r of res.rows) map[r.id] = r.label;
        out[job.column] = map;
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
): string {
  if (table.primaryKey.length === 0)
    throw new CrudError("Table has no primary key; editing is not supported");
  const parts = table.primaryKey.map((col) => {
    if (!(col in pk)) throw new CrudError(`Missing primary key part: ${col}`);
    values.push(String(pk[col]));
    return `${quoteIdent(col)}::text = $${values.length}`;
  });
  return parts.join(" AND ");
}

export async function getRow(
  connection: string,
  schema: string,
  tableName: string,
  pk: Record<string, unknown>,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  const values: unknown[] = [];
  const where = pkWhere(table, pk, values);
  const res = await getPool(conn, "read").query(
    `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(tableName)} WHERE ${where}`,
    values,
  );
  if (res.rows.length === 0) throw new CrudError("Row not found", 404);
  const row = res.rows[0];
  const fkLabels = await fetchFkLabels(conn, table, [row]);
  return { row, fkLabels };
}

// Options for a reference picker: search the referenced table by its display column.
export async function referenceOptions(
  connection: string,
  schema: string,
  tableName: string,
  refColumn: string,
  search: string,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  assertColumn(table, refColumn);
  const display = displayColumnFor(conn, table) ?? refColumn;
  const pool = getPool(conn, "read");
  const params: unknown[] = [];
  let where = "";
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE ${quoteIdent(display)}::text ILIKE $1 OR ${quoteIdent(refColumn)}::text ILIKE $1`;
  }
  const res = await pool.query(
    `SELECT ${quoteIdent(refColumn)}::text AS id, ${quoteIdent(display)}::text AS label
     FROM ${quoteIdent(schema)}.${quoteIdent(tableName)} ${where}
     ORDER BY 2 LIMIT 50`,
    params,
  );
  return res.rows as { id: string; label: string }[];
}

// ---------- writes ----------

function friendlyDbError(e: unknown): CrudError {
  const err = e as {
    code?: string;
    detail?: string;
    message?: string;
    column?: string;
    constraint?: string;
  };
  switch (err.code) {
    case "23505":
      return new CrudError(
        `Duplicate value violates unique constraint${err.detail ? `: ${err.detail}` : ""}`,
        409,
      );
    case "23503":
      return new CrudError(
        `Referenced row does not exist${err.detail ? `: ${err.detail}` : ""}`,
        409,
      );
    case "23502":
      return new CrudError(
        `"${err.column}" is required and cannot be empty`,
        400,
      );
    case "23514":
      return new CrudError(
        `Value violates check constraint "${err.constraint}"`,
        400,
      );
    case "22P02":
      return new CrudError(`Invalid value format: ${err.message}`, 400);
    case "42501":
      return new CrudError(
        "The write role lacks permission for this operation",
        403,
      );
    default:
      return new CrudError(err.message ?? "Database error", 400);
  }
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
): unknown {
  if (value === "" || value === undefined) return null;
  const col = table.columns.find((c) => c.name === column);
  if (
    col &&
    ["json", "jsonb"].includes(col.udtName) &&
    typeof value === "object" &&
    value !== null
  ) {
    return JSON.stringify(value);
  }
  return value;
}

export async function createRow(
  connection: string,
  schema: string,
  tableName: string,
  data: Record<string, unknown>,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const cols = writableColumns(table, data);
  if (cols.length === 0) throw new CrudError("No writable columns in payload");
  const values = cols.map((c) => coerceValue(table, c, data[c]));
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const sql = `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(tableName)} (${cols.map(quoteIdent).join(", ")})
               VALUES (${placeholders.join(", ")}) RETURNING *`;
  const pool = getPool(conn, "write");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(sql, values);
    await client.query("COMMIT");
    logAudit({
      action: "create",
      sql: `INSERT INTO ${schema}.${tableName}`,
      connections: [conn.name],
      rowCount: 1,
    });
    return res.rows[0];
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw friendlyDbError(e);
  } finally {
    client.release();
  }
}

export async function updateRow(
  connection: string,
  schema: string,
  tableName: string,
  pk: Record<string, unknown>,
  data: Record<string, unknown>,
  expectedUpdatedAt?: string,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const cols = writableColumns(table, data).filter(
    (c) => !table.primaryKey.includes(c),
  );
  if (cols.length === 0) throw new CrudError("No writable columns in payload");
  const values: unknown[] = cols.map((c) => coerceValue(table, c, data[c]));
  const sets = cols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`);
  let where = pkWhere(table, pk, values);
  // optimistic concurrency when the table has updated_at and caller sent the expected value
  if (expectedUpdatedAt && table.columns.some((c) => c.name === "updated_at")) {
    values.push(expectedUpdatedAt);
    where += ` AND updated_at = $${values.length}`;
  }
  const sql = `UPDATE ${quoteIdent(schema)}.${quoteIdent(tableName)} SET ${sets.join(", ")} WHERE ${where} RETURNING *`;
  const pool = getPool(conn, "write");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(sql, values);
    await client.query("COMMIT");
    if (res.rows.length === 0) {
      throw new CrudError(
        expectedUpdatedAt
          ? "Row was modified by someone else since you loaded it (or no longer exists)"
          : "Row not found",
        409,
      );
    }
    logAudit({
      action: "update",
      sql: `UPDATE ${schema}.${tableName}`,
      connections: [conn.name],
      rowCount: 1,
    });
    return res.rows[0];
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e instanceof CrudError) throw e;
    throw friendlyDbError(e);
  } finally {
    client.release();
  }
}

export async function deleteRow(
  connection: string,
  schema: string,
  tableName: string,
  pk: Record<string, unknown>,
) {
  const { conn, table } = await resolveTable(connection, schema, tableName);
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const values: unknown[] = [];
  const where = pkWhere(table, pk, values);
  const sql = `DELETE FROM ${quoteIdent(schema)}.${quoteIdent(tableName)} WHERE ${where}`;
  const pool = getPool(conn, "write");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(sql, values);
    await client.query("COMMIT");
    if (res.rowCount === 0) throw new CrudError("Row not found", 404);
    logAudit({
      action: "delete",
      sql: `DELETE FROM ${schema}.${tableName}`,
      connections: [conn.name],
      rowCount: res.rowCount,
    });
    return { deleted: res.rowCount };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e instanceof CrudError) throw e;
    throw friendlyDbError(e);
  } finally {
    client.release();
  }
}
