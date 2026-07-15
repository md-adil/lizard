import type { Migration } from "./runner";

// Phase 9D: connections gain a free-form driver-options string (URL query
// params like `authSource`, `directConnection`, `readPreference`) preserved
// from a pasted URI. Existing rows have none, so the column is nullable with no
// default and migrates transparently.
export const migration: Migration = {
  id: "0008_connection_options",
  up: () => `ALTER TABLE connections ADD COLUMN options TEXT`,
};
