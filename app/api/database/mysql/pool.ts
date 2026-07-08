// One mysql2 pool per (connection, role), mirroring lib/db/pools.ts for
// Postgres. Read pools are what introspection and (later) list/read use; write
// pools exist for CRUD. Dates come back as strings so the machine timezone
// never shifts a value, matching the Postgres pool's type parsers.
import { createPool, type Pool } from "mysql2/promise";
import type { ConnectionConfig } from "@/lib/types";

type Role = "read" | "write";

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
    pools.set(key, pool);
  }
  return pool;
}
