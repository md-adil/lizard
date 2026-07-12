import type { Migration } from "./runner";

// Opt-in scope for the cross-table global search feature — off by default,
// since scanning every table by default is exactly the unbounded fan-out
// the feature is designed to avoid.
export const migration: Migration = {
  id: "0006_searchable_tables",
  up: () => [`ALTER TABLE table_overrides ADD COLUMN searchable INTEGER NOT NULL DEFAULT 0`],
};
