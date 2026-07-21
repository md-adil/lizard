import type { Migration } from "./runner";

// Dashboard-wide filter variables ({{name}} tokens substituted into panel
// SQL client-side before it's sent to /api/query). Stored as a JSON array on
// the dashboard row, same shape as panels.chart_spec.
export const migration: Migration = {
  id: "0011_dashboard_variables",
  up: () => `ALTER TABLE dashboards ADD COLUMN variables TEXT NOT NULL DEFAULT '[]'`,
};
