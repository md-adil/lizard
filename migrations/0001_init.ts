import type { Migration } from "./runner";

// Baseline schema for the Lizard metadata store, as it existed before
// versioned migrations were introduced. IF NOT EXISTS so this is a no-op on
// databases that already have these objects from the old ad-hoc setup code.
export const migration: Migration = {
  id: "0001_init",
  up: () => `
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
    -- per-user grid column visibility ("Columns" toggle) -- distinct from
    -- column_overrides.hidden, which is a shared structural hide applied to
    -- every user and every surface (grid, record page, RowEditor). This is
    -- just one person's personal view preference for the grid.
    CREATE TABLE IF NOT EXISTS user_column_prefs (
      user_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, connection_id, schema_name, table_name, column_name)
    );
    -- Phase 8.9: per-record comments/annotations. Pure Lizard-side state,
    -- keyed by a canonical PK string; works on any target table, no DDL there.
    CREATE TABLE IF NOT EXISTS record_comments (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      author_name TEXT,
      connection_id TEXT NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      pk_key TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_record_comments_target
      ON record_comments (connection_id, schema_name, table_name, pk_key);
    -- Phase 8.3: saved views (named filter/sort/columns/view-type per table).
    CREATE TABLE IF NOT EXISTS saved_views (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      shared INTEGER NOT NULL DEFAULT 1,
      connection_id TEXT NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,   -- JSON: { filterSet, sort, sortDir, search, columnVisibility, viewType, groupBy }
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_saved_views_target
      ON saved_views (connection_id, schema_name, table_name);
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
  `,
};
