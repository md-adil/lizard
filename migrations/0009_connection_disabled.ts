import type { Migration } from "./runner";

// Lets an admin take a connection offline (hidden from Browse, blocked from
// queries) without deleting it and losing its saved customizations —
// mirrors users.disabled (0001_init).
export const migration: Migration = {
  id: "0009_connection_disabled",
  up: () => `ALTER TABLE connections ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`,
};
