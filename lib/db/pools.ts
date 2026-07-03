// One pg Pool per (connection, role). Read pools carry statement timeouts and
// are the only pools AI/chart/list queries ever touch. Write pools exist only
// for the CRUD service.
import { Pool } from "pg";
import type { ConnectionConfig } from "@/lib/types";
import { getConnection } from "@/lib/metadata/store";

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
    pools.set(key, pool);
  }
  return pool;
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
  const ssl = conn.ssl ? "?sslmode=require" : "";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass ?? "")}@${conn.host}:${conn.port}/${encodeURIComponent(conn.database)}${ssl}`;
}

export async function testConnection(conn: ConnectionConfig): Promise<{ read: string | null; write: string | null }> {
  const result: { read: string | null; write: string | null } = { read: null, write: null };
  try {
    const r = await getPool(conn, "read").query("SELECT 1");
    if (r.rowCount !== 1) result.read = "unexpected response";
  } catch (e) {
    result.read = e instanceof Error ? e.message : String(e);
  }
  if (conn.writeUser) {
    try {
      await getPool(conn, "write").query("SELECT 1");
    } catch (e) {
      result.write = e instanceof Error ? e.message : String(e);
    }
  }
  return result;
}
