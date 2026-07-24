// Name-only introspection for the ⌘K navigation palette. Unlike getCatalog()
// (columns + constraints + indexes, one heavy fan-out), this lists just
// schema/table names per connection — one cheap query each — so table-name
// search can span every readable connection without pulling the full catalog
// into memory. Cached per connection with a short TTL; a broken connection
// simply contributes nothing rather than failing the whole search.
import type { ConnectionConfig } from "@/lib/types";
import { getPool } from "@/lib/db/pools";
import { listSchemaNames } from "@/lib/introspect/catalog";

export interface TableNameEntry {
  // Always the concrete/resolved schema: a real Postgres schema, or the
  // database name for MySQL/Mongo. This is what table_overrides are keyed by;
  // callers decide whether to expose it (see supportsSchemas).
  schema: string;
  name: string;
  kind: "table" | "view";
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { entries: TableNameEntry[]; at: number }>();

export function invalidateTableNames(connectionId?: string): void {
  if (connectionId) cache.delete(connectionId);
  else cache.clear();
}

export async function listTableNames(conn: ConnectionConfig): Promise<TableNameEntry[]> {
  const cached = cache.get(conn.id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.entries;
  try {
    const entries = await introspectNames(conn);
    cache.set(conn.id, { entries, at: Date.now() });
    return entries;
  } catch {
    // Unreachable/broken connection: keep it out of results instead of
    // stalling the palette. The next call retries (nothing is cached).
    return [];
  }
}

async function introspectNames(conn: ConnectionConfig): Promise<TableNameEntry[]> {
  // MySQL/Mongo drivers stay lazy-imported so they're out of the module graph
  // for Postgres-only deployments — mirroring lib/introspect/catalog.ts.
  if (conn.engine === "mysql") return mysqlNames(conn);
  if (conn.engine === "mongo") return mongoNames(conn);
  return postgresNames(conn);
}

async function postgresNames(conn: ConnectionConfig): Promise<TableNameEntry[]> {
  // listSchemaNames honors allowedSchemas and excludes system schemas — reuse
  // it rather than re-deriving the schema filter here.
  const schemaNames = (await listSchemaNames(conn)).map((s) => s.name);
  if (schemaNames.length === 0) return [];
  const pool = getPool(conn, "read");
  const res = await pool.query<{ schema: string; name: string; kind: "table" | "view" }>(
    `SELECT n.nspname AS schema, c.relname AS name,
            CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END AS kind
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm') AND n.nspname = ANY($1)
     ORDER BY n.nspname, c.relname`,
    [schemaNames],
  );
  return res.rows.map((r) => ({ schema: r.schema, name: r.name, kind: r.kind }));
}

async function mysqlNames(conn: ConnectionConfig): Promise<TableNameEntry[]> {
  const { getMysqlPool } = await import("@/app/api/database/mysql/pool");
  const pool = getMysqlPool(conn, "read");
  // information_schema returns UPPERCASE column names unless aliased, so both
  // are aliased to the exact lowercase keys read below.
  const [rows] = await pool.query(
    `SELECT table_name AS name,
            CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind
     FROM information_schema.tables
     WHERE table_schema = ?
     ORDER BY table_name`,
    [conn.database],
  );
  return (rows as { name: string; kind: "table" | "view" }[]).map((r) => ({
    schema: conn.database,
    name: r.name,
    kind: r.kind,
  }));
}

async function mongoNames(conn: ConnectionConfig): Promise<TableNameEntry[]> {
  const { getMongoDb } = await import("@/app/api/database/mongo/client");
  const db = await getMongoDb(conn, "read");
  // nameOnly:false is still a cheap metadata call — needed only to tell views
  // from collections. System collections (system.*) are skipped, as in
  // introspectMongo.
  const colls = await db.listCollections({}, { nameOnly: false }).toArray();
  return colls
    .filter((c) => !String(c.name).startsWith("system."))
    .map((c) => ({
      schema: conn.database,
      name: c.name as string,
      kind: (c.type === "view" ? "view" : "table") as "table" | "view",
    }));
}
