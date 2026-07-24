// Query router: validates a QueryRequest through the SQL Guard, then executes
// on either a single connection's read-only pool (native Postgres) or the
// DuckDB federation engine. Everything is audited.
import type { QueryRequest, QueryResult } from "@/lib/types";
import { guardSql, GuardError, MAX_ROWS } from "@/lib/guard/guard";
import { getConnection, logAudit } from "@/lib/metadata/store";
import { getClient } from "@/app/api/database/postgres/pool";
import { runFederated } from "@/lib/federation/duckdb";
import { getDialect } from "@/app/api/database/registry";
import { cacheKeyFor, getCached, setCached } from "@/lib/query-cache";

// minimal OID → type-name map for result column labels
const OID_TYPES: Record<number, string> = {
  16: "boolean",
  20: "bigint",
  21: "smallint",
  23: "integer",
  25: "text",
  114: "json",
  700: "real",
  701: "double",
  1043: "varchar",
  1082: "date",
  1114: "timestamp",
  1184: "timestamptz",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
};

const MYSQL_TYPES: Record<number, string> = {
  1: "tinyint",
  2: "smallint",
  3: "integer",
  4: "float",
  5: "double",
  8: "bigint",
  9: "mediumint",
  10: "date",
  11: "time",
  12: "datetime",
  13: "year",
  245: "json",
  246: "decimal",
  253: "varchar",
  254: "char",
};

export { GuardError };

export async function runGuardedQuery(req: QueryRequest, actor = "admin"): Promise<QueryResult> {
  if (!Array.isArray(req.connections) || req.connections.length === 0) {
    throw new GuardError("At least one connection is required");
  }
  const conns = req.connections.map((name) => {
    const c = getConnection(name);
    if (!c) throw new GuardError(`Unknown connection: ${name}`);
    return c;
  });
  if (req.target === "single" && conns.length !== 1) {
    throw new GuardError("Single-target queries must name exactly one connection");
  }
  if (req.target === "single" && req.dialect !== conns[0].engine) {
    throw new GuardError(`Single-target queries must use the connection's engine dialect: ${conns[0].engine}`);
  }
  if (req.target === "federated" && req.dialect !== "duckdb") {
    throw new GuardError("Federated queries must use the duckdb dialect");
  }

  const cacheKey = req.cacheSeconds ? cacheKeyFor(req) : null;
  if (cacheKey) {
    const cached = getCached(cacheKey);
    if (cached) {
      logAudit({
        actor,
        action: "query_cached",
        sql: req.sql,
        connections: req.connections,
        rowCount: cached.rowCount,
        durationMs: 0,
      });
      return cached;
    }
  }

  const guarded = guardSql(req.sql, req.dialect);
  const started = Date.now();
  try {
    const result =
      req.target === "single"
        ? await runSingle(conns[0], guarded.wrappedSql, guarded.cleanSql)
        : await runFederated(conns, guarded.wrappedSql, guarded.cleanSql);
    logAudit({
      actor,
      action: req.target === "single" ? "query" : "federated_query",
      sql: guarded.cleanSql,
      connections: req.connections,
      rowCount: result.rowCount,
      durationMs: result.durationMs,
    });
    if (cacheKey && req.cacheSeconds) setCached(cacheKey, result, req.cacheSeconds);
    return result;
  } catch (e) {
    logAudit({
      actor,
      action: req.target === "single" ? "query" : "federated_query",
      sql: guarded.cleanSql,
      connections: req.connections,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

async function runSingle(
  conn: NonNullable<ReturnType<typeof getConnection>>,
  wrappedSql: string,
  originalSql: string,
): Promise<QueryResult> {
  const started = Date.now();
  const dialect = getDialect(conn.engine);
  const client = await getClient(conn, "read");
  try {
    const statements = dialect.beginReadOnly();
    for (const stmt of statements) {
      await client.query(stmt);
    }
    const res = await client.query(wrappedSql);
    await client.commit();
    const truncated = res.rows.length > MAX_ROWS;
    const rows = truncated ? res.rows.slice(0, MAX_ROWS) : res.rows;
    return {
      columns: res.fields.map((f) => {
        if (conn.engine === "mysql") {
          return { name: f.name, type: MYSQL_TYPES[f.columnType ?? 0] ?? `type:${f.columnType}` };
        }
        return { name: f.name, type: OID_TYPES[f.dataTypeID ?? 0] ?? `oid:${f.dataTypeID}` };
      }),
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
      connections: [conn.name],
      sql: originalSql,
    };
  } catch (e) {
    await client.rollback().catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
