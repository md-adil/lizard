// Lizard's own metadata store — a local SQLite file (node:sqlite, zero deps).
// Never writes to any target database.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ConnectionConfig,
  ConnectionInput,
  DbEngine,
  VirtualFk,
  TableOverride,
  ColumnOverride,
  RecordComment,
  SavedView,
  SavedQuery,
  Dashboard,
  Panel,
  ChartSpec,
} from "@/lib/types";
import { MIGRATIONS, runMigrations } from "@/migrations";

const DB_PATH = process.env.LIZARD_METADATA_PATH || join(process.cwd(), "data", "lizard.sqlite");

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

// Shared SQLite handle so the auth layer writes to the same metadata file.
export function getMetaDb(): DatabaseSync {
  return getDb();
}

// Opens the metadata DB and applies any pending migrations. Called once from
// instrumentation.ts at process startup, so migrations run before the first
// request instead of lazily inside it. Safe to call again — the module-level
// `db` cache means later calls (including getDb() elsewhere) are a no-op;
// this also acts as a fallback for contexts that don't run instrumentation
// (tests, scripts).
export function initMetadataDb(): void {
  const db = getDb();
  runMigrations(db, MIGRATIONS);
}

// ---------- connections ----------

function rowToConnection(r: Record<string, unknown>): ConnectionConfig {
  return {
    id: r.id as string,
    name: r.name as string,
    engine: r.engine as DbEngine,
    host: r.host as string,
    port: r.port as number,
    database: r.database as string,
    readUser: r.read_user as string,
    readPassword: r.read_password as string,
    writeUser: (r.write_user as string) || null,
    writePassword: (r.write_password as string) || null,
    ssl: !!r.ssl,
    allowedSchemas: r.allowed_schemas ? JSON.parse(r.allowed_schemas as string) : null,
    options: (r.options as string) || null,
    createdAt: r.created_at as string,
  };
}

export function listConnections(): ConnectionConfig[] {
  const rows = getDb().prepare("SELECT * FROM connections ORDER BY created_at").all();
  return rows.map((r) => rowToConnection(r as Record<string, unknown>));
}

export function getConnection(idOrName: string): ConnectionConfig | null {
  const r = getDb().prepare("SELECT * FROM connections WHERE id = ? OR name = ?").get(idOrName, idOrName);
  return r ? rowToConnection(r as Record<string, unknown>) : null;
}

export function addConnection(input: ConnectionInput): ConnectionConfig {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO connections (id, name, engine, host, port, database, read_user, read_password, write_user, write_password, ssl, allowed_schemas, options)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.engine,
      input.host,
      input.port,
      input.database,
      input.readUser,
      input.readPassword,
      input.writeUser,
      input.writePassword,
      input.ssl ? 1 : 0,
      input.allowedSchemas ? JSON.stringify(input.allowedSchemas) : null,
      input.options || null,
    );
  return getConnection(id)!;
}

export function updateConnection(id: string, input: Partial<ConnectionInput>): ConnectionConfig | null {
  const existing = getConnection(id);
  if (!existing) return null;
  // A partial update overrides only the keys actually provided. Dropping
  // undefined keys before merging is essential: spreading `{ ...existing,
  // ...input }` with an explicit `undefined` (e.g. writePassword left unchanged)
  // would otherwise blow away the stored value — and node:sqlite cannot bind
  // `undefined`, so the UPDATE would throw "cannot be bound to parameter".
  const provided = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const merged = { ...existing, ...provided };
  getDb()
    .prepare(
      `UPDATE connections SET name=?, engine=?, host=?, port=?, database=?, read_user=?, read_password=?, write_user=?, write_password=?, ssl=?, allowed_schemas=?, options=? WHERE id=?`,
    )
    .run(
      merged.name,
      merged.engine,
      merged.host,
      merged.port,
      merged.database,
      merged.readUser,
      merged.readPassword,
      merged.writeUser,
      merged.writePassword,
      merged.ssl ? 1 : 0,
      merged.allowedSchemas ? JSON.stringify(merged.allowedSchemas) : null,
      merged.options || null,
      id,
    );
  return getConnection(id);
}

export function deleteConnection(id: string): void {
  getDb().prepare("DELETE FROM connections WHERE id = ?").run(id);
}

// ---------- virtual FKs ----------

function mapVirtualFkRow(r: Record<string, unknown>): VirtualFk {
  return {
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
  };
}

export function listVirtualFks(): VirtualFk[] {
  const rows = getDb().prepare("SELECT * FROM virtual_fks").all() as Record<string, unknown>[];
  return rows.map(mapVirtualFkRow);
}

// Virtual FKs touching one connection, either as source or target — used by
// the per-schema catalog endpoint so a page for connection A doesn't pull in
// every other connection's relationships. `fromSchema`/`toSchema` may still
// be glob patterns, so callers filter down to an exact schema/table
// themselves (see vfkMatchesSource). from_connection/to_connection store the
// connection's stable id (not its mutable name) — renaming a connection must
// not orphan the relationships pointing at it.
export function listVirtualFksForConnection(connectionId: string): VirtualFk[] {
  const rows = getDb()
    .prepare("SELECT * FROM virtual_fks WHERE from_connection = ? OR to_connection = ?")
    .all(connectionId, connectionId) as Record<string, unknown>[];
  return rows.map(mapVirtualFkRow);
}

export function addVirtualFk(fk: Omit<VirtualFk, "id">): VirtualFk {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO virtual_fks (id, from_connection, from_schema, from_table, to_connection, to_schema, to_table, pairs, constants, label, join_hint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      fk.joinHint,
    );
  return { ...fk, id };
}

export function deleteVirtualFk(id: string): void {
  getDb().prepare("DELETE FROM virtual_fks WHERE id = ?").run(id);
}

// ---------- overrides ----------

// JSON-encoded array/object columns (primary_key, options, option_labels)
// are all NULL-or-valid-JSON — never partially written — so a parse failure
// only means "nothing stored yet".
function parseJsonColumn<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

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
    primaryKey: parseJsonColumn<string[]>(r.primary_key),
    searchable: !!r.searchable,
    defaultSort: (r.default_sort as string) || null,
    defaultSortDir: (r.default_sort_dir as "asc" | "desc") || null,
  };
}

function mapTableOverrideRow(r: Record<string, unknown>): TableOverride {
  return {
    connectionId: r.connection_id as string,
    schema: r.schema_name as string,
    table: r.table_name as string,
    hidden: !!r.hidden,
    displayColumn: (r.display_column as string) || null,
    label: (r.label as string) || null,
    primaryKey: parseJsonColumn<string[]>(r.primary_key),
    searchable: !!r.searchable,
    defaultSort: (r.default_sort as string) || null,
    defaultSortDir: (r.default_sort_dir as "asc" | "desc") || null,
  };
}

export function listTableOverrides(): TableOverride[] {
  const rows = getDb().prepare("SELECT * FROM table_overrides").all() as Record<string, unknown>[];
  return rows.map(mapTableOverrideRow);
}

// Scoped to one connection — `schema` on a row may be a glob pattern (e.g.
// multi-tenant "org_*"), so callers still resolve the winning override for a
// concrete schema themselves (see resolveTableOverride).
export function listTableOverridesForConnection(connectionId: string): TableOverride[] {
  const rows = getDb()
    .prepare("SELECT * FROM table_overrides WHERE connection_id = ?")
    .all(connectionId) as Record<string, unknown>[];
  return rows.map(mapTableOverrideRow);
}

export function setTableOverride(o: TableOverride): void {
  getDb()
    .prepare(
      `INSERT INTO table_overrides (connection_id, schema_name, table_name, hidden, display_column, label, primary_key, searchable, default_sort, default_sort_dir)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (connection_id, schema_name, table_name)
       DO UPDATE SET hidden=excluded.hidden, display_column=excluded.display_column, label=excluded.label,
                     primary_key=excluded.primary_key, searchable=excluded.searchable,
                     default_sort=excluded.default_sort, default_sort_dir=excluded.default_sort_dir`,
    )
    .run(
      o.connectionId,
      o.schema,
      o.table,
      o.hidden ? 1 : 0,
      o.displayColumn,
      o.label,
      o.primaryKey ? JSON.stringify(o.primaryKey) : null,
      o.searchable ? 1 : 0,
      o.defaultSort,
      o.defaultSortDir,
    );
}

function mapColumnOverrideRow(r: Record<string, unknown>): ColumnOverride {
  return {
    connectionId: r.connection_id as string,
    schema: r.schema_name as string,
    table: r.table_name as string,
    column: r.column_name as string,
    label: (r.label as string) || null,
    widget: (r.widget as string) || null,
    hidden: !!r.hidden,
    hiddenInGrid: !!r.hidden_in_grid,
    readonly: !!r.readonly,
    redacted: !!r.redacted,
    sortOrder: r.sort_order as number | null,
    help: (r.help as string) || null,
    options: parseJsonColumn<string[]>(r.options),
    optionLabels: parseJsonColumn<Record<string, string>>(r.option_labels),
  };
}

export function listColumnOverrides(): ColumnOverride[] {
  const rows = getDb().prepare("SELECT * FROM column_overrides").all() as Record<string, unknown>[];
  return rows.map(mapColumnOverrideRow);
}

// Scoped to one connection — `schema`/`table` on a row may be glob patterns,
// so callers still resolve the winning override for a concrete schema/table
// themselves (see resolveColumnOverrides).
export function listColumnOverridesForConnection(connectionId: string): ColumnOverride[] {
  const rows = getDb()
    .prepare("SELECT * FROM column_overrides WHERE connection_id = ?")
    .all(connectionId) as Record<string, unknown>[];
  return rows.map(mapColumnOverrideRow);
}

export function getColumnOverrides(connectionId: string, schema: string, table: string): ColumnOverride[] {
  return listColumnOverridesForConnection(connectionId).filter((o) => o.schema === schema && o.table === table);
}

export function setColumnOverride(o: ColumnOverride): void {
  getDb()
    .prepare(
      `INSERT INTO column_overrides (connection_id, schema_name, table_name, column_name, label, widget, hidden, hidden_in_grid, readonly, redacted, sort_order, help, options, option_labels)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (connection_id, schema_name, table_name, column_name)
       DO UPDATE SET label=excluded.label, widget=excluded.widget, hidden=excluded.hidden, hidden_in_grid=excluded.hidden_in_grid,
                     readonly=excluded.readonly, redacted=excluded.redacted, sort_order=excluded.sort_order, help=excluded.help,
                     options=excluded.options, option_labels=excluded.option_labels`,
    )
    .run(
      o.connectionId,
      o.schema,
      o.table,
      o.column,
      o.label,
      o.widget,
      o.hidden ? 1 : 0,
      o.hiddenInGrid ? 1 : 0,
      o.readonly ? 1 : 0,
      o.redacted ? 1 : 0,
      o.sortOrder,
      o.help,
      o.options ? JSON.stringify(o.options) : null,
      o.optionLabels ? JSON.stringify(o.optionLabels) : null,
    );
}

// ---------- per-user grid column visibility ----------

// { [columnName]: hidden } for one user's view of one table.
export function getUserColumnPrefs(
  userId: string,
  connectionId: string,
  schema: string,
  table: string,
): Record<string, boolean> {
  const rows = getDb()
    .prepare(
      `SELECT column_name, hidden FROM user_column_prefs
       WHERE user_id=? AND connection_id=? AND schema_name=? AND table_name=?`,
    )
    .all(userId, connectionId, schema, table) as Record<string, unknown>[];
  const out: Record<string, boolean> = {};
  for (const r of rows) out[r.column_name as string] = !!r.hidden;
  return out;
}

export function setUserColumnPref(
  userId: string,
  connectionId: string,
  schema: string,
  table: string,
  column: string,
  hidden: boolean,
): void {
  getDb()
    .prepare(
      `INSERT INTO user_column_prefs (user_id, connection_id, schema_name, table_name, column_name, hidden)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, connection_id, schema_name, table_name, column_name)
       DO UPDATE SET hidden=excluded.hidden`,
    )
    .run(userId, connectionId, schema, table, column, hidden ? 1 : 0);
}

// ---------- per-user, per-table generic preferences ----------

// One JSON blob per (user, connection, schema, table) — e.g. { viewType,
// groupBy, ... }. Prefer this over a new table+column for every future
// preference; only reach for a dedicated table when a preference needs its
// own indexing/query shape (like user_column_prefs, keyed per-column).
export function getUserTablePrefs(
  userId: string,
  connectionId: string,
  schema: string,
  table: string,
): Record<string, unknown> {
  const row = getDb()
    .prepare(
      `SELECT prefs FROM user_table_prefs
       WHERE user_id=? AND connection_id=? AND schema_name=? AND table_name=?`,
    )
    .get(userId, connectionId, schema, table) as { prefs: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.prefs);
  } catch {
    return {};
  }
}

export function setUserTablePref(
  userId: string,
  connectionId: string,
  schema: string,
  table: string,
  key: string,
  value: unknown,
): void {
  const current = getUserTablePrefs(userId, connectionId, schema, table);
  current[key] = value;
  getDb()
    .prepare(
      `INSERT INTO user_table_prefs (user_id, connection_id, schema_name, table_name, prefs)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, connection_id, schema_name, table_name)
       DO UPDATE SET prefs=excluded.prefs`,
    )
    .run(userId, connectionId, schema, table, JSON.stringify(current));
}

// ---------- record comments (Phase 8.9) ----------

// Canonical, order-independent string for a PK object so the same row always
// maps to the same key regardless of how the caller built the object.
export function canonicalPkKey(pk: Record<string, unknown>): string {
  const keys = Object.keys(pk).sort();
  return JSON.stringify(keys.map((k) => [k, pk[k] == null ? null : String(pk[k])]));
}

function rowToComment(r: Record<string, unknown>): RecordComment {
  return {
    id: r.id as string,
    authorId: r.author_id as string,
    authorName: (r.author_name as string) || null,
    connectionId: r.connection_id as string,
    schema: r.schema_name as string,
    table: r.table_name as string,
    pkKey: r.pk_key as string,
    body: r.body as string,
    createdAt: r.created_at as string,
  };
}

export function listRecordComments(
  connectionId: string,
  schema: string,
  table: string,
  pkKey: string,
): RecordComment[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM record_comments
       WHERE connection_id=? AND schema_name=? AND table_name=? AND pk_key=?
       ORDER BY created_at`,
    )
    .all(connectionId, schema, table, pkKey) as Record<string, unknown>[];
  return rows.map(rowToComment);
}

export function addRecordComment(c: Omit<RecordComment, "id" | "createdAt">): RecordComment {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO record_comments (id, author_id, author_name, connection_id, schema_name, table_name, pk_key, body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, c.authorId, c.authorName, c.connectionId, c.schema, c.table, c.pkKey, c.body);
  return getDb().prepare("SELECT * FROM record_comments WHERE id=?").get(id) as unknown as RecordComment;
}

// Returns the comment's author_id so the route can enforce author-or-admin.
export function getRecordCommentAuthor(id: string): string | null {
  const r = getDb().prepare("SELECT author_id FROM record_comments WHERE id=?").get(id) as
    { author_id?: string } | undefined;
  return r?.author_id ?? null;
}

export function deleteRecordComment(id: string): void {
  getDb().prepare("DELETE FROM record_comments WHERE id=?").run(id);
}

// ---------- saved views (Phase 8.3) ----------

function rowToSavedView(r: Record<string, unknown>): SavedView {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    shared: !!r.shared,
    connectionId: r.connection_id as string,
    schema: r.schema_name as string,
    table: r.table_name as string,
    name: r.name as string,
    config: JSON.parse((r.config as string) || "{}"),
    createdAt: r.created_at as string,
  };
}

// Views visible to a user: shared ones + their own private ones.
export function listSavedViews(userId: string, connectionId: string, schema: string, table: string): SavedView[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM saved_views
       WHERE connection_id=? AND schema_name=? AND table_name=?
         AND (shared=1 OR owner_id=?)
       ORDER BY name`,
    )
    .all(connectionId, schema, table, userId) as Record<string, unknown>[];
  return rows.map(rowToSavedView);
}

export function addSavedView(v: Omit<SavedView, "id" | "createdAt">): SavedView {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO saved_views (id, owner_id, shared, connection_id, schema_name, table_name, name, config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, v.ownerId, v.shared ? 1 : 0, v.connectionId, v.schema, v.table, v.name, JSON.stringify(v.config));
  return getDb().prepare("SELECT * FROM saved_views WHERE id=?").get(id) as unknown as SavedView;
}

export function getSavedViewOwner(id: string): string | null {
  const r = getDb().prepare("SELECT owner_id FROM saved_views WHERE id=?").get(id) as { owner_id?: string } | undefined;
  return r?.owner_id ?? null;
}

export function deleteSavedView(id: string): void {
  getDb().prepare("DELETE FROM saved_views WHERE id=?").run(id);
}

// ---------- saved queries ----------

export function listSavedQueries(): SavedQuery[] {
  const rows = getDb().prepare("SELECT * FROM saved_queries ORDER BY created_at DESC").all() as Record<
    string,
    unknown
  >[];
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
      "INSERT INTO saved_queries (id, name, nl_prompt, target, connections, sql, dialect) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
    panels: (
      d.prepare("SELECT * FROM panels WHERE dashboard_id = ?").all(r.id as string) as Record<string, unknown>[]
    ).map(rowToPanel),
  }));
}

export function getDashboard(id: string): Dashboard | null {
  return listDashboards().find((d) => d.id === id) ?? null;
}

export function addDashboard(name: string, refreshSeconds: number | null = null): Dashboard {
  const id = randomUUID();
  getDb().prepare("INSERT INTO dashboards (id, name, refresh_seconds) VALUES (?, ?, ?)").run(id, name, refreshSeconds);
  return getDashboard(id)!;
}

export function updateDashboard(id: string, fields: { name?: string; refreshSeconds?: number | null }): void {
  const existing = getDashboard(id);
  if (!existing) return;
  getDb()
    .prepare("UPDATE dashboards SET name = ?, refresh_seconds = ? WHERE id = ?")
    .run(
      fields.name ?? existing.name,
      fields.refreshSeconds === undefined ? existing.refreshSeconds : fields.refreshSeconds,
      id,
    );
}

export function deleteDashboard(id: string): void {
  const d = getDb();
  d.prepare("DELETE FROM panels WHERE dashboard_id = ?").run(id);
  d.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
}

export function addPanel(
  dashboardId: string,
  spec: ChartSpec,
  pos?: { x: number; y: number; w: number; h: number },
): Panel {
  const id = randomUUID();
  const p = pos ?? { x: 0, y: 0, w: 6, h: 8 };
  getDb()
    .prepare("INSERT INTO panels (id, dashboard_id, chart_spec, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, dashboardId, JSON.stringify(spec), p.x, p.y, p.w, p.h);
  return { id, dashboardId, spec, ...p };
}

export function updatePanel(
  id: string,
  fields: { spec?: ChartSpec; x?: number; y?: number; w?: number; h?: number },
): void {
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
      id,
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
      "INSERT INTO audit_log (actor, action, sql, connections, row_count, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      entry.actor ?? "admin",
      entry.action,
      entry.sql ?? null,
      entry.connections ? JSON.stringify(entry.connections) : null,
      entry.rowCount ?? null,
      entry.durationMs ?? null,
      entry.error ?? null,
    );
}

export function listAudit(limit = 200): Record<string, unknown>[] {
  return getDb().prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit) as Record<string, unknown>[];
}
