// Catalog/introspection types: connection → schema → table, fully qualified
// so nothing is ambiguous across the fleet.
import type { DbEngine } from "./connection";
import type { VirtualFk, TableOverride, ColumnOverride } from "./overrides";

// Precision/scale/sign metadata for a numeric-family column — null on the
// column itself for anything non-numeric, so no dead keys ride along on
// every text/date/bool/json column just to say "not applicable".
export interface ColumnNumericInfo {
  precision: number | null; // total digits (or bits, for plain integers)
  scale: number | null; // digits after the decimal point; 0 for integers
  unsigned: boolean; // MySQL-only — Postgres has no unsigned integer types
}

export interface ColumnInfo {
  name: string;
  dataType: string; // formatted type e.g. "character varying(255)"
  udtName: string; // underlying type e.g. "varchar", "int8", enum name
  nullable: boolean;
  default: string | null;
  isGenerated: boolean;
  ordinal: number;
  comment: string | null;
  enumValues: string[] | null;
  // The schema the enum type itself is defined in — may differ from the
  // column's own table schema (e.g. one enum shared by every tenant schema
  // in a schema-per-tenant layout). Needed to schema-qualify a cast to this
  // type; null for non-enum columns and engines with no type namespace.
  enumSchema: string | null;
  maxLength: number | null;
  numeric: ColumnNumericInfo | null;
}

export interface ForeignKeyInfo {
  constraintName: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
}

export interface CheckConstraintInfo {
  name: string;
  expression: string;
  // populated when the check is a simple `col IN (...)` — drives select widgets
  inColumn: string | null;
  inValues: string[] | null;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: "table" | "view";
  comment: string | null;
  rowEstimate: number;
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: ForeignKeyInfo[];
  uniqueConstraints: string[][];
  checkConstraints: CheckConstraintInfo[];
  // every column covered by any index (PK, unique, or plain/secondary) —
  // the cheap-to-search set global search narrows to (see
  // lib/data/global-search.ts). Not tied to a specific index/constraint,
  // just "is this column indexed at all".
  indexedColumns: string[];
}

export interface SchemaCatalog {
  name: string;
  tables: TableInfo[];
}

export interface ConnectionCatalog {
  connectionId: string;
  connectionName: string;
  engine: DbEngine;
  database: string;
  schemas: SchemaCatalog[];
  fetchedAt: string;
  error?: string;
}

export interface Catalog {
  connections: ConnectionCatalog[];
  virtualFks: VirtualFk[];
}

// ---------- client catalog API ----------
// The client never needs full table/column definitions for every connection
// up front — that doesn't scale to a fleet of many schemas. `/api/catalog`
// returns just a light connection/schema tree; table detail (and the
// overrides/virtual-FKs scoped to one connection) load lazily per schema via
// `/api/catalog/[connection]?schema=…`. Shared between the route handlers and
// the client hooks so both sides stay in sync.

export interface LightSchemaCatalog {
  name: string;
}

export interface LightConnectionCatalog {
  connectionId: string;
  connectionName: string;
  database: string;
  engine: DbEngine;
  error?: string;
  schemas: LightSchemaCatalog[];
}

export interface CatalogResponse {
  connections: LightConnectionCatalog[];
}

// Response for `/api/catalog/[connection]?schema=…` — one schema's tables
// plus the overrides/virtual-FKs for that connection (virtual FKs may point
// at or come from other connections, but are still scoped to ones touching
// this connection).
export interface SchemaDetail extends SchemaCatalog {
  virtualFks: VirtualFk[];
  tableOverrides: TableOverride[];
  columnOverrides: ColumnOverride[];
}

// ---------- resolved reference labels ----------

// A label cannot be keyed by the reference column's value alone. Laravel-style
// polymorphic relations reuse one id column across several parent tables and
// discriminate with a type column (`subject_id` + `subject_type`), so id `1`
// may be a Course, a Batch and a CourseLesson at once — keying by `subject_id`
// would hand the Course's title to every one of them.
//
// So each column's label set declares the source columns that identify a row's
// target: the reference column plus any source-side constant (discriminator)
// columns. Labels are keyed by those values together.
export interface FkLabelSet {
  // keyColumns[0] is the reference column; the rest are source-side
  // discriminators, sorted for determinism.
  keyColumns: string[];
  labels: Record<string, string>;
}

export type FkLabels = Record<string, FkLabelSet>;
