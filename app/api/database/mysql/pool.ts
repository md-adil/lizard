// One mysql2 pool per (connection, role), mirroring lib/db/pools.ts for
// Postgres. Read pools are what introspection and (later) list/read use; write
// pools exist for CRUD. Dates come back as strings so the machine timezone
// never shifts a value, matching the Postgres pool's type parsers.
import { createPool, type Pool } from "mysql2/promise";
import type { ConnectionConfig } from "@/lib/types";

type Role = "read" | "write";

// Postgres enforces a statement_timeout at the connection level (see
// READ_STATEMENT_TIMEOUT_MS in lib/db/pools.ts) so a slow/unindexed query
// gets killed by the server itself — the query stops consuming CPU/locks/
// memory there, not just abandoned client-side — instead of hanging the pool
// (and eventually the target database) for however long a full scan takes.
// MySQL has no equivalent startup parameter, so it's set per connection here.
// MAX_EXECUTION_TIME only bounds read-only SELECTs, which is exactly what the
// read pool runs (listRows/listGroupedRows/export/introspection); the write
// pool's risk is lock contention rather than a runaway scan, so it gets a
// lock-wait cap instead.
const READ_MAX_EXECUTION_TIME_MS = 10_000;
const WRITE_LOCK_WAIT_TIMEOUT_S = 15;

const pools = new Map<string, Pool>();

function poolKey(conn: ConnectionConfig, role: Role): string {
  const user = role === "read" ? conn.readUser : conn.writeUser;
  return `${conn.id}:${role}:${conn.host}:${conn.port}:${conn.database}:${user}`;
}

export function getMysqlPool(conn: ConnectionConfig, role: Role): Pool {
  if (role === "write" && (!conn.writeUser || !conn.writePassword)) {
    throw new Error(`Connection "${conn.name}" is read-only (no write credentials registered)`);
  }
  const key = poolKey(conn, role);
  let pool = pools.get(key);
  if (!pool) {
    pool = createPool({
      host: conn.host,
      port: conn.port,
      database: conn.database,
      user: role === "read" ? conn.readUser : conn.writeUser!,
      password: role === "read" ? conn.readPassword : conn.writePassword!,
      ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
      connectionLimit: 5,
      connectTimeout: 8_000,
      dateStrings: true,
      // Keep numeric/bigint values readable and lossless as strings where they
      // would overflow a JS number; the grid renders them as text anyway.
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    // Fires once per physical connection, after the handshake completes (see
    // BasePool.getConnection in mysql2) — same timing as the Postgres pool's
    // `on("connect", ...)` this mirrors, so the session variable is set
    // before the connection is ever handed back to a caller.
    pool.on("connection", (connection) => {
      if (role === "read") {
        connection.query(`SET SESSION MAX_EXECUTION_TIME=${READ_MAX_EXECUTION_TIME_MS}`);
      } else {
        connection.query(`SET SESSION innodb_lock_wait_timeout=${WRITE_LOCK_WAIT_TIMEOUT_S}`);
      }
    });
    pools.set(key, pool);
  }
  return pool;
}
