import type { Migration } from "./runner";

// "Grid settings" customize tab: a per-column "hidden in grid only" flag
// (distinct from `hidden`, which hides everywhere including the record
// view/edit pages) and a per-table default sort column/direction.
export const migration: Migration = {
  id: "0007_grid_settings",
  up: () => [
    `ALTER TABLE column_overrides ADD COLUMN hidden_in_grid INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE table_overrides ADD COLUMN default_sort TEXT`,
    `ALTER TABLE table_overrides ADD COLUMN default_sort_dir TEXT`,
  ],
};
