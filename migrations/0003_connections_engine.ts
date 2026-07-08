import type { Migration } from "./runner";

// Phase 9: connections gain a target-engine discriminator. Existing rows were
// all Postgres, so the column defaults to 'postgres' and migrates transparently.
export const migration: Migration = {
  id: "0003_connections_engine",
  up: () => `ALTER TABLE connections ADD COLUMN engine TEXT NOT NULL DEFAULT 'postgres'`,
};
