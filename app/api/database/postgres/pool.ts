// One pg Pool per (connection, role). Read pools carry statement timeouts and
// are the only pools AI/chart/list queries ever touch. Write pools exist only
// for the CRUD service.
import { Pool, types } from "pg";
import type { ConnectionConfig, DbEngine } from "@/lib/types";
import { getConnection } from "@/lib/metadata/store";
import { logQuery, logAcquire, logPoolError, type QueryLogContext } from "@/lib/logger";
import { poolKey, type Role } from "../pools-helper";

// Return timestamps as raw strings instead of JS Date objects so the
// machine's local timezone never shifts the value during parsing.
types.setTypeParser(1114, (v) => v); // timestamp without timezone
types.setTypeParser(1184, (v) => v); // timestamp with timezone
types.setTypeParser(1082, (v) => v); // date

const READ_STATEMENT_TIMEOUT_MS = 10_000;
const WRITE_STATEMENT_TIMEOUT_MS = 15_000;

const pools = new Map<string, Pool>();

export function getPool(conn: ConnectionConfig, role: Role): Pool {
  if (role === "write" && (!conn.writeUser || !conn.writePassword)) {
    throw new Error(`Connection "${conn.name}" is read-only (no write credentials registered)`);
  }
  const key = poolKey(conn.id, role);
  let pool = pools.get(key);
  if (!pool) {
    pool = new Pool({
      host: conn.host,
      port: conn.port,
      database: conn.database,
      user: role === "read" ? conn.readUser : conn.writeUser!,
      password: role === "read" ? conn.readPassword : conn.writePassword!,
      ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
      max: role === "read" ? 12 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      options: `-c statement_timeout=${role === "read" ? READ_STATEMENT_TIMEOUT_MS : WRITE_STATEMENT_TIMEOUT_MS} -c idle_in_transaction_session_timeout=15000`,
    });
    pool.on("error", (err) => logPoolError({ connection: conn.name, engine: conn.engine, role }, err));
    // Use UTC for every session so timestamp↔timestamptz comparisons are
    // deterministic regardless of the server's local timezone setting.
    pool.on("connect", (client) => {
      client.query("SET timezone = 'UTC'");
    });
    pools.set(key, pool);
  }
  return pool;
}

// poolKey is just id:role, so a pool survives an edit to its connection's
// host/port/database/credentials — without closing it here the cached pool
// would keep serving the pre-edit config forever. Deleting a connection has
// the same problem: its pool(s) would otherwise stay open with no way to
// reach them again. Called (alongside mysql's closePools) from the
// connections API on update/delete — see close-pools.ts.
export function closePools(connectionId: string): void {
  for (const role of ["read", "write"] as const) {
    const key = poolKey(connectionId, role);
    const pool = pools.get(key);
    if (pool) {
      pools.delete(key);
      pool.end().catch(() => {});
    }
  }
}

export interface DbClient {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{
    rows: Record<string, any>[];
    rowCount: number;
    fields: { name: string; dataTypeID?: number; columnType?: number }[];
    insertId?: number;
  }>;
  release(): void;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

// Every statement this app runs against a target database goes through
// DbClient.query, so timing/tracing belongs here rather than at each call
// site. See lib/logger.ts for the env switches.
function instrument(client: DbClient, ctx: QueryLogContext): DbClient {
  return {
    ...client,
    async query(sql, params) {
      const startedAt = performance.now();
      try {
        const res = await client.query(sql, params);
        logQuery(ctx, sql, params, performance.now() - startedAt, { rowCount: res.rowCount });
        return res;
      } catch (e) {
        logQuery(ctx, sql, params, performance.now() - startedAt, { error: e });
        throw e;
      }
    },
  };
}

const ACQUIRE_TIMEOUT_MS = 8_000;

// pool.connect()/pool.getConnection() had no bound at all: a connection that
// looks idle to the pool but is actually dead on the wire (dropped by a
// firewall/LB, killed server-side) would hang here forever with nothing
// logged, since instrument() only starts timing once a connection is already
// in hand. If the acquire eventually does resolve after we've timed out,
// release it immediately instead of leaking it out of the pool's limited
// connection count.
function acquireWithTimeout<T extends { release: () => void }>(
  acquire: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(message));
    }, ms);
    acquire.then(
      (conn) => {
        clearTimeout(timer);
        if (timedOut) {
          conn.release();
        } else {
          resolve(conn);
        }
      },
      (err) => {
        clearTimeout(timer);
        if (!timedOut) reject(err);
      },
    );
  });
}

export async function getClient(conn: ConnectionConfig, role: Role): Promise<DbClient> {
  const ctx: QueryLogContext = { connection: conn.name, engine: conn.engine, role };

  if (conn.engine === "postgres") {
    const pool = getPool(conn, role);
    const acquireStartedAt = performance.now();
    let client;
    try {
      client = await acquireWithTimeout(
        pool.connect(),
        ACQUIRE_TIMEOUT_MS,
        `Timed out acquiring a connection from "${conn.name}" (${role}) after ${ACQUIRE_TIMEOUT_MS}ms`,
      );
    } catch (e) {
      logAcquire(ctx, performance.now() - acquireStartedAt, e);
      throw e;
    }
    logAcquire(ctx, performance.now() - acquireStartedAt);
    return instrument(
      {
        async query(sql, params) {
          const res = await client.query(sql, params);
          return {
            rows: res.rows,
            rowCount: res.rowCount ?? 0,
            fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
          };
        },
        release() {
          client.release();
        },
        async beginTransaction() {
          await client.query("BEGIN");
        },
        async commit() {
          await client.query("COMMIT");
        },
        async rollback() {
          await client.query("ROLLBACK");
        },
      },
      ctx,
    );
  } else if (conn.engine === "mysql") {
    const { getMysqlPool } = await import("@/app/api/database/mysql/pool");
    const pool = getMysqlPool(conn, role);
    const acquireStartedAt = performance.now();
    let connection;
    try {
      connection = await acquireWithTimeout(
        pool.getConnection(),
        ACQUIRE_TIMEOUT_MS,
        `Timed out acquiring a connection from "${conn.name}" (${role}) after ${ACQUIRE_TIMEOUT_MS}ms`,
      );
    } catch (e) {
      logAcquire(ctx, performance.now() - acquireStartedAt, e);
      throw e;
    }
    logAcquire(ctx, performance.now() - acquireStartedAt);
    return instrument(
      {
        async query(sql, params) {
          const [results, fields] = await connection.query(sql, params);
          const isHeader = results && !Array.isArray(results);
          return {
            rows: isHeader ? [] : (results as any[]),
            rowCount: isHeader ? (results as any).affectedRows : (results as any[]).length,
            fields: (fields || []).map((f) => ({ name: f.name, columnType: f.columnType })),
            insertId: isHeader ? (results as any).insertId : undefined,
          };
        },
        release() {
          connection.release();
        },
        async beginTransaction() {
          await connection.beginTransaction();
        },
        async commit() {
          await connection.commit();
        },
        async rollback() {
          await connection.rollback();
        },
      },
      ctx,
    );
  } else {
    throw new Error(`Engine "${conn.engine}" is not supported yet`);
  }
}

export function getPoolByName(connectionName: string, role: Role): { conn: ConnectionConfig; pool: Pool } {
  const conn = getConnection(connectionName);
  if (!conn) throw new Error(`Unknown connection: ${connectionName}`);
  return { conn, pool: getPool(conn, role) };
}

export function connectionUri(conn: ConnectionConfig, role: Role): string {
  const user = role === "read" ? conn.readUser : conn.writeUser;
  const pass = role === "read" ? conn.readPassword : conn.writePassword;
  if (!user) throw new Error(`Connection "${conn.name}" has no ${role} credentials`);
  if (conn.engine === "mysql") {
    return `host=${conn.host} port=${conn.port} user=${user} password=${pass ?? ""} db=${conn.database}`;
  }
  const ssl = conn.ssl ? "?sslmode=require" : "";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass ?? "")}@${conn.host}:${conn.port}/${encodeURIComponent(conn.database)}${ssl}`;
}

interface ProbeConfig {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  // Free-form Mongo driver options (authSource/directConnection/…). Ignored by
  // the relational probes.
  options?: string | null;
}

// One-off connectivity probe that does NOT touch the pool cache — used by the
// "Test connection" button and the connection-list status. Returns null on
// success or the error message. Dispatches by engine.
export async function probeCredentials(cfg: ProbeConfig): Promise<string | null> {
  if (cfg.engine === "mysql") return probeMysql(cfg);
  if (cfg.engine === "mongo") {
    const { probeMongo } = await import("@/app/api/database/mongo/client");
    return probeMongo(cfg);
  }
  return probePostgres(cfg);
}

async function probePostgres(cfg: ProbeConfig): Promise<string | null> {
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 7_000,
    options: "-c statement_timeout=7000",
  });
  try {
    await pool.query("SELECT 1");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function probeMysql(cfg: ProbeConfig): Promise<string | null> {
  // Lazy-load the driver so the module graph only pulls in mysql2 when a MySQL
  // connection is actually probed.
  const mysql = await import("mysql2/promise");
  let conn: Awaited<ReturnType<typeof mysql.createConnection>> | null = null;
  try {
    conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 7_000,
    });
    await conn.query("SELECT 1");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

export async function testConnection(conn: ConnectionConfig): Promise<{ read: string | null; write: string | null }> {
  const base = {
    engine: conn.engine,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    ssl: conn.ssl,
    options: conn.options,
  };
  const read = await probeCredentials({ ...base, user: conn.readUser, password: conn.readPassword });
  let write: string | null = null;
  if (conn.writeUser) {
    write = await probeCredentials({ ...base, user: conn.writeUser, password: conn.writePassword ?? "" });
  }
  return { read, write };
}

export async function discoverDatabases(cfg: {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
  options?: string | null;
}): Promise<string[]> {
  if (cfg.engine === "mysql") {
    const mysql = await import("mysql2/promise");
    let conn: any = null;
    try {
      conn = await mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database || undefined,
        user: cfg.user,
        password: cfg.password || "",
        ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
        connectTimeout: 7_000,
      });
      const [rows] = await conn.query(
        "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') ORDER BY 1",
      );
      return (rows as { name: string }[]).map((r) => r.name);
    } catch {
      return [];
    } finally {
      if (conn) await conn.end().catch(() => {});
    }
  }

  if (cfg.engine === "mongo") {
    const { discoverMongoDatabases } = await import("@/app/api/database/mongo/client");
    return discoverMongoDatabases({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      ssl: cfg.ssl,
      options: cfg.options,
    });
  }

  if (cfg.engine === "postgres") {
    const pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password || "",
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      max: 1,
      connectionTimeoutMillis: 7_000,
      options: "-c statement_timeout=7000",
    });
    try {
      const res = await pool.query(
        "SELECT datname AS name FROM pg_database WHERE datallowconn = true AND NOT datistemplate ORDER BY 1",
      );
      return res.rows.map((r: any) => String(r.name));
    } catch {
      return [];
    } finally {
      await pool.end().catch(() => {});
    }
  }

  return [];
}
