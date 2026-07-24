// One mysql2 pool per (connection, role), mirroring lib/db/pools.ts for
// Postgres. Read pools are what introspection and (later) list/read use; write
// pools exist for CRUD. Dates come back as strings so the machine timezone
// never shifts a value, matching the Postgres pool's type parsers.
import { createPool, type Pool } from "mysql2/promise";
import type { ConnectionConfig } from "@/lib/types";
import { logPoolError } from "@/lib/logger";
import { poolKey, type Role } from "../pools-helper";

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

// A connection can be edited (host/port/database/credentials) without its id
// changing — the pool cached under this id:role would otherwise keep serving
// the pre-edit config forever. Called from the connections API on
// update/delete (see app/api/connections/[id]/route.ts) so the next lookup
// recreates the pool from the current config.
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

export function getMysqlPool(conn: ConnectionConfig, role: Role): Pool {
  if (role === "write" && (!conn.writeUser || !conn.writePassword)) {
    throw new Error(`Connection "${conn.name}" is read-only (no write credentials registered)`);
  }
  const key = poolKey(conn.id, role);
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
      // TCP keepalive so a connection dropped by a firewall/LB/NAT idle
      // timeout gets noticed at the socket level instead of sitting in the
      // pool looking healthy until something tries to use it and hangs
      // forever with no error on either side.
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      // Bounded so a caller waiting on a connection fails with a clear
      // "pool exhausted" error instead of queuing indefinitely (the mysql2
      // default is 0 = unlimited) behind a connection that will never free up.
      queueLimit: 20,
      dateStrings: true,
      // Keep numeric/bigint values readable and lossless as strings where they
      // would overflow a JS number; the grid renders them as text anyway.
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    const ctx = { connection: conn.name, engine: conn.engine, role };
    // Fires once per physical connection, after the handshake completes (see
    // BasePool.getConnection in mysql2) — same timing as the Postgres pool's
    // `on("connect", ...)` this mirrors, so the session variable is set
    // before the connection is ever handed back to a caller.
    pool.on("connection", (connection) => {
      // mysql2's promise Pool only re-emits acquire/connection/enqueue/release
      // from the core pool — never "error" — so a pool-level listener is a
      // no-op. Each physical connection is its own EventEmitter and does emit
      // "error" for socket/protocol failures (PROTOCOL_CONNECTION_LOST,
      // ECONNRESET); with no listener here that error had nowhere to go and
      // no log line was ever produced for it.
      connection.on("error", (err) => logPoolError(ctx, err));
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
