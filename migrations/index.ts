import type { Migration } from "./runner";
import { migration as m0001 } from "./0001_init";
import { migration as m0002 } from "./0002_column_overrides_redacted";
import { migration as m0003 } from "./0003_connections_engine";
import { migration as m0004 } from "./0004_user_table_prefs";

export type { Migration } from "./runner";
export { runMigrations } from "./runner";

// Applied in order; add new migrations by appending, never reordering or
// editing an already-shipped one.
export const MIGRATIONS: Migration[] = [m0001, m0002, m0003, m0004];
