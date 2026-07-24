// One MongoClient per (connection, role), mirroring lib/db/pools.ts (Postgres)
// and app/api/database/mysql/pool.ts (MySQL). MongoDB has no SQL and no
// server-enforced statement_timeout knob in the connection string, so reads
// carry a per-operation `maxTimeMS` (applied at each find/aggregate call site
// in data.ts) and the read role is used only for find/aggregate — never a
// write method. Writes go through the write client, which requires write
// credentials just like the relational engines.
import { MongoClient, type Db } from "mongodb";
import type { ConnectionConfig, DbEngine } from "@/lib/types";
import { poolKey, type Role } from "../pools-helper";
import { logPoolError } from "@/lib/logger";

// Per-operation time budget for reads. There is no connection-level equivalent
// in MongoDB, so it is threaded through as `maxTimeMS` on each read op.
export const READ_MAX_TIME_MS = 10_000;
export const WRITE_MAX_TIME_MS = 15_000;

const clients = new Map<string, MongoClient>();

// Same leak as the relational pools (app/api/database/pools.ts): without this,
// editing a connection's host/port/database/credentials would keep serving
// the pre-edit MongoClient forever (poolKey is just id:role, not a config
// fingerprint), and deleting a connection would leak its client(s) with no
// way to reach them again. Called from the connections API via closePools.
export function closePools(connectionId: string): void {
  for (const role of ["read", "write"] as const) {
    const key = poolKey(connectionId, role);
    const client = clients.get(key);
    if (client) {
      clients.delete(key);
      client.close().catch(() => {});
    }
  }
}

interface MongoCredentials {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  // Extra driver options as a URL query string (authSource, directConnection,
  // readPreference, replicaSet, …), preserved from the registered connection.
  options?: string | null;
}

// Build a standard `mongodb://` connection URI. Credentials are percent-encoded
// so passwords containing URI metacharacters (`@`, `/`, `:`) survive intact.
// The connection's stored `options` (authSource, readPreference, replicaSet, …)
// are merged in verbatim, and Lizard-owned defaults fill any gaps:
//   - `directConnection=true` — a Lizard Mongo connection is always a single
//     host:port, so direct-connect is correct; without it the driver attempts
//     replica-set/SRV topology discovery and times out against a lone public
//     node (exactly the "test connection hangs 8s then fails" symptom).
//   - `serverSelectionTimeoutMS` — fail fast instead of the driver's 30s default.
//   - `tls=true` — when the connection is marked SSL and options didn't set it.
export function buildMongoUri(c: MongoCredentials): string {
  const auth = c.user ? `${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@` : "";
  const params = new URLSearchParams(c.options ?? "");
  if (!params.has("directConnection") && !params.has("replicaSet")) {
    params.set("directConnection", "true");
  }
  if (!params.has("serverSelectionTimeoutMS")) params.set("serverSelectionTimeoutMS", "8000");
  if (c.ssl && !params.has("tls") && !params.has("ssl")) params.set("tls", "true");
  const qs = params.toString();
  const dbSeg = c.database ? `/${encodeURIComponent(c.database)}` : "";
  return `mongodb://${auth}${c.host}:${c.port}${dbSeg}${qs ? `?${qs}` : ""}`;
}

function credsFor(conn: ConnectionConfig, role: Role): MongoCredentials {
  if (role === "write" && (!conn.writeUser || !conn.writePassword)) {
    throw new Error(`Connection "${conn.name}" is read-only (no write credentials registered)`);
  }
  return {
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: role === "read" ? conn.readUser : conn.writeUser!,
    password: role === "read" ? conn.readPassword : conn.writePassword!,
    ssl: conn.ssl,
    options: conn.options,
  };
}

// A cached, connected MongoClient for this connection/role. The MongoClient
// maintains its own internal connection pool, so one client per key is the
// documented reuse model (unlike pg/mysql where we cache a pool).
export async function getMongoClient(conn: ConnectionConfig, role: Role): Promise<MongoClient> {
  const key = poolKey(conn.id, role);
  let client = clients.get(key);
  if (!client) {
    client = new MongoClient(buildMongoUri(credsFor(conn, role)), { maxPoolSize: 5 });
    client.on("error", (err) => logPoolError({ connection: conn.name, engine: conn.engine, role }, err));
    await client.connect();
    clients.set(key, client);
  }
  return client;
}

// The Db handle for a connection/role. Mongo has no schema namespace, so — like
// MySQL — the connection's database name is the single synthetic schema.
export async function getMongoDb(conn: ConnectionConfig, role: Role): Promise<Db> {
  const client = await getMongoClient(conn, role);
  return client.db(conn.database);
}

// One-off connectivity probe that does NOT touch the client cache — used by the
// "Test connection" button and the connection-list status.
export async function probeMongo(cfg: {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  options?: string | null;
}): Promise<string | null> {
  const client = new MongoClient(buildMongoUri(cfg), { maxPoolSize: 1 });
  try {
    await client.connect();
    await client.db(cfg.database || "admin").command({ ping: 1 });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    await client.close().catch(() => {});
  }
}

// Enumerate databases on the server, for the connection form's database picker.
// Requires the `listDatabases` privilege; returns [] when it is not granted.
export async function discoverMongoDatabases(cfg: {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
  options?: string | null;
}): Promise<string[]> {
  const client = new MongoClient(buildMongoUri({ ...cfg, password: cfg.password ?? "" }), { maxPoolSize: 1 });
  try {
    await client.connect();
    const res = await client.db().admin().listDatabases({ nameOnly: true });
    return res.databases
      .map((d) => d.name)
      .filter((n) => !["admin", "local", "config"].includes(n))
      .sort();
  } catch {
    return [];
  } finally {
    await client.close().catch(() => {});
  }
}
