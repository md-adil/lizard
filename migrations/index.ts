import type { Migration } from "./runner";
import { migration as m0001 } from "./0001_init";
import { migration as m0002 } from "./0002_column_overrides_redacted";
import { migration as m0003 } from "./0003_connections_engine";
import { migration as m0004 } from "./0004_user_table_prefs";
import { migration as m0005 } from "./0005_pk_and_enum_overrides";
import { migration as m0006 } from "./0006_searchable_tables";
import { migration as m0007 } from "./0007_grid_settings";
import { migration as m0008 } from "./0008_connection_options";
import { migration as m0009 } from "./0009_connection_disabled";

export type { Migration } from "./runner";
export { runMigrations } from "./runner";

// Applied in order; add new migrations by appending, never reordering or
// editing an already-shipped one.
export const MIGRATIONS: Migration[] = [m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009];
