// Lizard's own metadata store — a local SQLite file (node:sqlite, zero deps).
// Never writes to any target database.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ConnectionConfig,
  ConnectionInput,
  VirtualFk,
  TableOverride,
  ColumnOverride,
  SavedQuery,
  Dashboard,
  Panel,
  ChartSpec,
} from "@/lib/types";

const DB_PATH =
  process.env.LIZARD_METADATA_PATH || join(process.cwd(), "data", "lizard.sqlite");

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      database TEXT NOT NULL,
      read_user TEXT NOT NULL,
      read_password TEXT NOT NULL,
      write_user TEXT,
      write_password TEXT,
      ssl INTEGER NOT NULL DEFAULT 0,
      allowed_schemas TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS virtual_fks (
      id TEXT PRIMARY KEY,
      from_connection TEXT NOT NULL,
      from_schema TEXT NOT NULL,
      from_table TEXT NOT NULL,
      to_connection TEXT NOT NULL,
      to_schema TEXT NOT NULL,
      to_table TEXT NOT NULL,
      pairs TEXT NOT NULL,      -- JSON: VfkPair[]
      constants TEXT NOT NULL,  -- JSON: VfkConstant[]
      label TEXT,
      join_hint TEXT
    );
    CREATE TABLE IF NOT EXISTS table_overrides (
      connection_id TEXT NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      display_column TEXT,
      label TEXT,
      PRIMARY KEY (connection_id, schema_name, table_name)
    );
    CREATE TABLE IF NOT EXISTS column_overrides (
      connection_id TEXT NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      label TEXT,
      widget TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      readonly INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER,
      help TEXT,
      PRIMARY KEY (connection_id, schema_name, table_name, column_name)
    );
    CREATE TABLE IF NOT EXISTS saved_queries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nl_prompt TEXT,
      target TEXT NOT NULL,
      connections TEXT NOT NULL,
      sql TEXT NOT NULL,
      dialect TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      refresh_seconds INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS panels (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
      chart_spec TEXT NOT NULL,
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      w INTEGER NOT NULL DEFAULT 6,
      h INTEGER NOT NULL DEFAULT 8
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL DEFAULT 'admin',
      action TEXT NOT NULL,
      sql TEXT,
      connections TEXT,
      row_count INTEGER,
      duration_ms INTEGER,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    -- per-connection access control; admins bypass this entirely
    CREATE TABLE IF NOT EXISTS connection_grants (
      user_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      access TEXT NOT NULL DEFAULT 'read',  -- 'read' | 'write'
      PRIMARY KEY (user_id, connection_id)
    );
  `);
  return db;
}

// Shared SQLite handle so the auth layer writes to the same metadata file.
export function getMetaDb(): DatabaseSync {
  return getDb();
}

// ---------- connections ----------

function rowToConnection(r: Record<string, unknown>): ConnectionConfig {
  return {
    id: r.id as string,
    name: r.name as string,
    host: r.host as string,
    port: r.port as number,
    database: r.database as string,
    readUser: r.read_user as string,
    readPassword: r.read_password as string,
    writeUser: (r.write_user as string) || null,
    writePassword: (r.write_password as string) || null,
    ssl: !!r.ssl,
    allowedSchemas: r.allowed_schemas ? JSON.parse(r.allowed_schemas as string) : null,
    createdAt: r.created_at as string,
  };
}

export function listConnections(): ConnectionConfig[] {
  const rows = getDb().prepare("SELECT * FROM connections ORDER BY created_at").all();
  return rows.map((r) => rowToConnection(r as Record<string, unknown>));
}

export function getConnection(idOrName: string): ConnectionConfig | null {
  const r = getDb()
    .prepare("SELECT * FROM connections WHERE id = ? OR name = ?")
    .get(idOrName, idOrName);
  return r ? rowToConnection(r as Record<string, unknown>) : null;
}

export function addConnection(input: ConnectionInput): ConnectionConfig {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO connections (id, name, host, port, database, read_user, read_password, write_user, write_password, ssl, allowed_schemas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.host,
      input.port,
      input.database,
      input.readUser,
      input.readPassword,
      input.writeUser,
      input.writePassword,
      input.ssl ? 1 : 0,
      input.allowedSchemas ? JSON.stringify(input.allowedSchemas) : null
    );
  return getConnection(id)!;
}

export function updateConnection(id: string, input: Partial<ConnectionInput>): ConnectionConfig | null {
  const existing = getConnection(id);
  if (!existing) return null;
  const merged = { ...existing, ...input };
  getDb()
    .prepare(
      `UPDATE connections SET name=?, host=?, port=?, database=?, read_user=?, read_password=?, write_user=?, write_password=?, ssl=?, allowed_schemas=? WHERE id=?`
    )
    .run(
      merged.name,
      merged.host,
      merged.port,
      merged.database,
      merged.readUser,
      merged.readPassword,
      merged.writeUser,
      merged.writePassword,
      merged.ssl ? 1 : 0,
      merged.allowedSchemas ? JSON.stringify(merged.allowedSchemas) : null,
      id
    );
  return getConnection(id);
}

export function deleteConnection(id: string): void {
  getDb().prepare("DELETE FROM connections WHERE id = ?").run(id);
}

// ---------- virtual FKs ----------

export function listVirtualFks(): VirtualFk[] {
  const rows = getDb().prepare("SELECT * FROM virtual_fks").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    fromConnection: r.from_connection as string,
    fromSchema: r.from_schema as string,
    fromTable: r.from_table as string,
    toConnection: r.to_connection as string,
    toSchema: r.to_schema as string,
    toTable: r.to_table as string,
    pairs: JSON.parse((r.pairs as string) || "[]"),
    constants: JSON.parse((r.constants as string) || "[]"),
    label: (r.label as string) || null,
    joinHint: (r.join_hint as string) || null,
  }));
}

export function addVirtualFk(fk: Omit<VirtualFk, "id">): VirtualFk {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO virtual_fks (id, from_connection, from_schema, from_table, to_connection, to_schema, to_table, pairs, constants, label, join_hint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      fk.fromConnection,
      fk.fromSchema,
      fk.fromTable,
      fk.toConnection,
      fk.toSchema,
      fk.toTable,
      JSON.stringify(fk.pairs),
      JSON.stringify(fk.constants),
      fk.label,
      fk.joinHint
    );
  return { ...fk, id };
}

export function deleteVirtualFk(id: string): void {
  getDb().prepare("DELETE FROM virtual_fks WHERE id = ?").run(id);
}

// ---------- overrides ----------

export function getTableOverride(connectionId: string, schema: string, table: string): TableOverride | null {
  const r = getDb()
    .prepare("SELECT * FROM table_overrides WHERE connection_id=? AND schema_name=? AND table_name=?")
    .get(connectionId, schema, table) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    connectionId,
    schema,
    table,
    hidden: !!r.hidden,
    displayColumn: (r.display_column as string) || null,
    label: (r.label as string) || null,
  };
}

export function listTableOverrides(): TableOverride[] {
  const rows = getDb().prepare("SELECT * FROM table_overrides").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    connectionId: r.connection_id as string,
    schema: r.schema_name as string,
    table: r.table_name as string,
    hidden: !!r.hidden,
    displayColumn: (r.display_column as string) || null,
    label: (r.label as string) || null,
  }));
}

export function setTableOverride(o: TableOverride): void {
  getDb()
    .prepare(
      `INSERT INTO table_overrides (connection_id, schema_name, table_name, hidden, display_column, label)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (connection_id, schema_name, table_name)
       DO UPDATE SET hidden=excluded.hidden, display_column=excluded.display_column, label=excluded.label`
    )
    .run(o.connectionId, o.schema, o.table, o.hidden ? 1 : 0, o.displayColumn, o.label);
}

export function listColumnOverrides(): ColumnOverride[] {
  const rows = getDb().prepare("SELECT * FROM column_overrides").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    connectionId: r.connection_id as string,
    schema: r.schema_name as string,
    table: r.table_name as string,
    column: r.column_name as string,
    label: (r.label as string) || null,
    widget: (r.widget as string) || null,
    hidden: !!r.hidden,
    readonly: !!r.readonly,
    sortOrder: r.sort_order as number | null,
    help: (r.help as string) || null,
  }));
}

export function getColumnOverrides(connectionId: string, schema: string, table: string): ColumnOverride[] {
  return listColumnOverrides().filter(
    (o) => o.connectionId === connectionId && o.schema === schema && o.table === table
  );
}

export function setColumnOverride(o: ColumnOverride): void {
  getDb()
    .prepare(
      `INSERT INTO column_overrides (connection_id, schema_name, table_name, column_name, label, widget, hidden, readonly, sort_order, help)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (connection_id, schema_name, table_name, column_name)
       DO UPDATE SET label=excluded.label, widget=excluded.widget, hidden=excluded.hidden,
                     readonly=excluded.readonly, sort_order=excluded.sort_order, help=excluded.help`
    )
    .run(
      o.connectionId,
      o.schema,
      o.table,
      o.column,
      o.label,
      o.widget,
      o.hidden ? 1 : 0,
      o.readonly ? 1 : 0,
      o.sortOrder,
      o.help
    );
}

// ---------- saved queries ----------

export function listSavedQueries(): SavedQuery[] {
  const rows = getDb().prepare("SELECT * FROM saved_queries ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    nlPrompt: (r.nl_prompt as string) || null,
    target: r.target as SavedQuery["target"],
    connections: JSON.parse(r.connections as string),
    sql: r.sql as string,
    dialect: r.dialect as SavedQuery["dialect"],
    createdAt: r.created_at as string,
  }));
}

export function addSavedQuery(q: Omit<SavedQuery, "id" | "createdAt">): SavedQuery {
  const id = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO saved_queries (id, name, nl_prompt, target, connections, sql, dialect) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(id, q.name, q.nlPrompt, q.target, JSON.stringify(q.connections), q.sql, q.dialect);
  return listSavedQueries().find((s) => s.id === id)!;
}

export function deleteSavedQuery(id: string): void {
  getDb().prepare("DELETE FROM saved_queries WHERE id = ?").run(id);
}

// ---------- dashboards & panels ----------

function rowToPanel(r: Record<string, unknown>): Panel {
  return {
    id: r.id as string,
    dashboardId: r.dashboard_id as string,
    spec: JSON.parse(r.chart_spec as string) as ChartSpec,
    x: r.x as number,
    y: r.y as number,
    w: r.w as number,
    h: r.h as number,
  };
}

export function listDashboards(): Dashboard[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM dashboards ORDER BY created_at").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    refreshSeconds: r.refresh_seconds as number | null,
    createdAt: r.created_at as string,
    panels: (d.prepare("SELECT * FROM panels WHERE dashboard_id = ?").all(r.id as string) as Record<string, unknown>[]).map(rowToPanel),
  }));
}

export function getDashboard(id: string): Dashboard | null {
  return listDashboards().find((d) => d.id === id) ?? null;
}

export function addDashboard(name: string, refreshSeconds: number | null = null): Dashboard {
  const id = randomUUID();
  getDb()
    .prepare("INSERT INTO dashboards (id, name, refresh_seconds) VALUES (?, ?, ?)")
    .run(id, name, refreshSeconds);
  return getDashboard(id)!;
}

export function updateDashboard(id: string, fields: { name?: string; refreshSeconds?: number | null }): void {
  const existing = getDashboard(id);
  if (!existing) return;
  getDb()
    .prepare("UPDATE dashboards SET name = ?, refresh_seconds = ? WHERE id = ?")
    .run(fields.name ?? existing.name, fields.refreshSeconds === undefined ? existing.refreshSeconds : fields.refreshSeconds, id);
}

export function deleteDashboard(id: string): void {
  const d = getDb();
  d.prepare("DELETE FROM panels WHERE dashboard_id = ?").run(id);
  d.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
}

export function addPanel(dashboardId: string, spec: ChartSpec, pos?: { x: number; y: number; w: number; h: number }): Panel {
  const id = randomUUID();
  const p = pos ?? { x: 0, y: 0, w: 6, h: 8 };
  getDb()
    .prepare("INSERT INTO panels (id, dashboard_id, chart_spec, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, dashboardId, JSON.stringify(spec), p.x, p.y, p.w, p.h);
  return { id, dashboardId, spec, ...p };
}

export function updatePanel(id: string, fields: { spec?: ChartSpec; x?: number; y?: number; w?: number; h?: number }): void {
  const r = getDb().prepare("SELECT * FROM panels WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!r) return;
  const cur = rowToPanel(r);
  getDb()
    .prepare("UPDATE panels SET chart_spec=?, x=?, y=?, w=?, h=? WHERE id=?")
    .run(
      JSON.stringify(fields.spec ?? cur.spec),
      fields.x ?? cur.x,
      fields.y ?? cur.y,
      fields.w ?? cur.w,
      fields.h ?? cur.h,
      id
    );
}

export function deletePanel(id: string): void {
  getDb().prepare("DELETE FROM panels WHERE id = ?").run(id);
}

// ---------- audit ----------

export function logAudit(entry: {
  actor?: string;
  action: string;
  sql?: string | null;
  connections?: string[] | null;
  rowCount?: number | null;
  durationMs?: number | null;
  error?: string | null;
}): void {
  getDb()
    .prepare(
      "INSERT INTO audit_log (actor, action, sql, connections, row_count, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      entry.actor ?? "admin",
      entry.action,
      entry.sql ?? null,
      entry.connections ? JSON.stringify(entry.connections) : null,
      entry.rowCount ?? null,
      entry.durationMs ?? null,
      entry.error ?? null
    );
}

export function listAudit(limit = 200): Record<string, unknown>[] {
  return getDb()
    .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
}
