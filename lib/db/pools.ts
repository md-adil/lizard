// One pg Pool per (connection, role). Read pools carry statement timeouts and
// are the only pools AI/chart/list queries ever touch. Write pools exist only
// for the CRUD service.
import { Pool, types } from "pg";
import type { ConnectionConfig, DbEngine } from "@/lib/types";
import { getConnection } from "@/lib/metadata/store";
import { logQuery, type QueryLogContext } from "@/lib/logger";

// Return timestamps as raw strings instead of JS Date objects so the
// machine's local timezone never shifts the value during parsing.
types.setTypeParser(1114, (v) => v); // timestamp without timezone
types.setTypeParser(1184, (v) => v); // timestamp with timezone
types.setTypeParser(1082, (v) => v); // date

const READ_STATEMENT_TIMEOUT_MS = 10_000;
const WRITE_STATEMENT_TIMEOUT_MS = 15_000;

type Role = "read" | "write";

const pools = new Map<string, Pool>();

function poolKey(conn: ConnectionConfig, role: Role): string {
  // include credentials fingerprint so edits to a connection create a new pool
  return `${conn.id}:${role}:${conn.host}:${conn.port}:${conn.database}:${role === "read" ? conn.readUser : conn.writeUser}`;
}

export function getPool(conn: ConnectionConfig, role: Role): Pool {
  if (role === "write" && (!conn.writeUser || !conn.writePassword)) {
    throw new Error(`Connection "${conn.name}" is read-only (no write credentials registered)`);
  }
  const key = poolKey(conn, role);
  let pool = pools.get(key);
  if (!pool) {
    pool = new Pool({
      host: conn.host,
      port: conn.port,
      database: conn.database,
      user: role === "read" ? conn.readUser : conn.writeUser!,
      password: role === "read" ? conn.readPassword : conn.writePassword!,
      ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      options: `-c statement_timeout=${role === "read" ? READ_STATEMENT_TIMEOUT_MS : WRITE_STATEMENT_TIMEOUT_MS} -c idle_in_transaction_session_timeout=15000`,
    });
    pool.on("error", () => {
      /* keep a broken backend connection from crashing the process */
    });
    // Use UTC for every session so timestamp↔timestamptz comparisons are
    // deterministic regardless of the server's local timezone setting.
    pool.on("connect", (client) => {
      client.query("SET timezone = 'UTC'");
    });
    pools.set(key, pool);
  }
  return pool;
}

export interface DbClient {
  query(sql: string, params?: unknown[]): Promise<{
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

export async function getClient(conn: ConnectionConfig, role: Role): Promise<DbClient> {
  const ctx: QueryLogContext = { connection: conn.name, engine: conn.engine, role };

  if (conn.engine === "postgres") {
    const pool = getPool(conn, role);
    const client = await pool.connect();
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
    const connection = await pool.getConnection();
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
}

// One-off connectivity probe that does NOT touch the pool cache — used by the
// "Test connection" button and the connection-list status. Returns null on
// success or the error message. Dispatches by engine.
export async function probeCredentials(cfg: ProbeConfig): Promise<string | null> {
  if (cfg.engine === "mysql") return probeMysql(cfg);
  if (cfg.engine === "mongo") return "MongoDB connectivity is not available yet";
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
  };
  const read = await probeCredentials({ ...base, user: conn.readUser, password: conn.readPassword });
  let write: string | null = null;
  if (conn.writeUser) {
    write = await probeCredentials({ ...base, user: conn.writeUser, password: conn.writePassword ?? "" });
  }
  return { read, write };
}
