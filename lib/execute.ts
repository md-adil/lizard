// Query router: validates a QueryRequest through the SQL Guard, then executes
// on either a single connection's read-only pool (native Postgres) or the
// DuckDB federation engine. Everything is audited.
import type { QueryRequest, QueryResult } from "@/lib/types";
import { guardSql, GuardError, MAX_ROWS } from "@/lib/guard/guard";
import { getConnection, logAudit } from "@/lib/metadata/store";
import { getPool } from "@/lib/db/pools";
import { runFederated } from "@/lib/federation/duckdb";

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
  if (req.target === "single" && req.dialect !== "postgres") {
    throw new GuardError("Single-target queries must use the postgres dialect");
  }
  if (req.target === "federated" && req.dialect !== "duckdb") {
    throw new GuardError("Federated queries must use the duckdb dialect");
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
  const pool = getPool(conn, "read");
  const client = await pool.connect();
  try {
    // belt-and-suspenders on top of the read-only role
    await client.query("BEGIN TRANSACTION READ ONLY");
    const res = await client.query(wrappedSql);
    await client.query("COMMIT");
    const truncated = res.rows.length > MAX_ROWS;
    const rows = truncated ? res.rows.slice(0, MAX_ROWS) : res.rows;
    return {
      columns: res.fields.map((f) => ({ name: f.name, type: OID_TYPES[f.dataTypeID] ?? `oid:${f.dataTypeID}` })),
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
      connections: [conn.name],
      sql: originalSql,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may be dead */
    }
    throw e;
  } finally {
    client.release();
  }
}
