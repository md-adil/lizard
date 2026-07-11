import type { Migration } from "./runner";

// Generic per-user, per-table preference store — one JSON blob per
// (user, connection, schema, table) instead of a dedicated table+column per
// preference. New preferences (view type, group-by, whatever comes next)
// are just new keys in the same blob; see lib/metadata/store.ts
// getUserTablePrefs/setUserTablePref.
export const migration: Migration = {
  id: "0004_user_table_prefs",
  up: () => `
    CREATE TABLE IF NOT EXISTS user_table_prefs (
      user_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      prefs TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (user_id, connection_id, schema_name, table_name)
    );
  `,
};
