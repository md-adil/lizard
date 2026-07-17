import type { Migration } from "./runner";

// Per-user pinned dashboards, surfaced in the sidebar under the Dashboards
// nav item. Pins are a personal preference, so they key on user_id — not a
// flag on the dashboard row, which would make one user's pin everyone's.
export const migration: Migration = {
  id: "0010_dashboard_pins",
  up: () => `
    CREATE TABLE IF NOT EXISTS dashboard_pins (
      user_id TEXT NOT NULL REFERENCES users(id),
      dashboard_id TEXT NOT NULL REFERENCES dashboards(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, dashboard_id)
    )
  `,
};
