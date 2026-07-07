import type { Migration } from "./runner";

// Adds the "redact this column's values" flag to column_overrides.
export const migration: Migration = {
  id: "0002_column_overrides_redacted",
  up: () => `ALTER TABLE column_overrides ADD COLUMN redacted INTEGER NOT NULL DEFAULT 0`,
};
