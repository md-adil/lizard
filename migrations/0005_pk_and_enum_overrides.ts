import type { Migration } from "./runner";

// Table customization: a "pretend" primary key for tables introspection
// found none on (Laravel-style pivot tables), plus per-column custom enum
// options and per-value display labels. All three are JSON-encoded (array /
// object), NULL when unset.
export const migration: Migration = {
  id: "0005_pk_and_enum_overrides",
  up: () => [
    `ALTER TABLE table_overrides ADD COLUMN primary_key TEXT`,
    `ALTER TABLE column_overrides ADD COLUMN options TEXT`,
    `ALTER TABLE column_overrides ADD COLUMN option_labels TEXT`,
  ],
};
