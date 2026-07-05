// Shared types across Lizard. Everything fully qualifies tables as
// connection → schema → table; nothing is ambiguous across the fleet.

export interface ConnectionConfig {
  id: string;
  name: string; // unique slug-ish label, used as the federation alias
  host: string;
  port: number;
  database: string;
  readUser: string;
  readPassword: string;
  writeUser: string | null;
  writePassword: string | null;
  ssl: boolean;
  allowedSchemas: string[] | null; // null = all non-system schemas
  createdAt: string;
}

export type ConnectionInput = Omit<ConnectionConfig, "id" | "createdAt">;

// ---------- catalog ----------

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
  maxLength: number | null;
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
}

export interface SchemaCatalog {
  name: string;
  tables: TableInfo[];
}

export interface ConnectionCatalog {
  connectionId: string;
  connectionName: string;
  database: string;
  schemas: SchemaCatalog[];
  fetchedAt: string;
  error?: string;
}

export interface Catalog {
  connections: ConnectionCatalog[];
  virtualFks: VirtualFk[];
}

// ---------- metadata / overrides ----------

// Transform applied symmetrically to both sides of an equi-join comparison so
// values that differ only by case/whitespace still match (e.g. LOWER(a)=LOWER(b)).
export type VfkTransform = "none" | "lower" | "upper" | "trim";

export interface VfkPair {
  from: string; // source column
  to: string; // target column
  transform?: VfkTransform; // default "none"
}

// Constant predicate on the target side, e.g. target.type = 'user'.
export interface VfkConstant {
  toColumn: string;
  value: string; // compared as text
}

export interface VirtualFk {
  id: string;
  fromConnection: string; // connection name
  fromSchema: string;
  fromTable: string;
  toConnection: string;
  // toSchema may be a literal, or the sentinel "$schema" meaning "resolve in the
  toSchema: string;
  toTable: string;
  // Equi-join column pairs (>= 1). pairs[0].from is the display column: the one
  // that renders as a reference and whose value keys the resolved label map.
  pairs: VfkPair[];
  // Extra constant predicates AND-ed onto the target lookup.
  constants: VfkConstant[];
  label: string | null;
  // Free-text join expression for conditions too complex to execute (OR,
  // functions, subqueries). Fed to the AI as a hint only; never run.
  joinHint: string | null;
}

export interface TableOverride {
  connectionId: string;
  schema: string;
  table: string;
  hidden: boolean;
  displayColumn: string | null;
  label: string | null;
}

export interface ColumnOverride {
  connectionId: string;
  schema: string;
  table: string;
  column: string;
  label: string | null;
  widget: string | null;
  hidden: boolean;
  readonly: boolean;
  sortOrder: number | null;
  help: string | null;
}

// ---------- querying ----------

export type QueryTarget = "single" | "federated";
export type SqlDialect = "postgres" | "duckdb";

export interface QueryRequest {
  target: QueryTarget;
  connections: string[]; // connection names
  sql: string;
  dialect: SqlDialect;
}

export interface QueryResultColumn {
  name: string;
  type: string; // best-effort type name
}

export interface QueryResult {
  columns: QueryResultColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  connections: string[]; // which connections were touched
  sql: string; // the SQL actually executed (pre-wrap)
}

export interface SavedQuery {
  id: string;
  name: string;
  nlPrompt: string | null;
  target: QueryTarget;
  connections: string[];
  sql: string;
  dialect: SqlDialect;
  createdAt: string;
}

// ---------- charts & dashboards ----------

export type ChartType = "line" | "bar" | "pie" | "stat" | "table" | "area";

export interface ChartSpec {
  title: string;
  chartType: ChartType;
  target: QueryTarget;
  connections: string[];
  sql: string;
  dialect: SqlDialect;
  xField: string | null;
  yFields: string[];
  seriesField: string | null; // categorical column that splits into series
}

export interface Panel {
  id: string;
  dashboardId: string;
  spec: ChartSpec;
  // grid position: 12-column layout
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dashboard {
  id: string;
  name: string;
  refreshSeconds: number | null;
  createdAt: string;
  panels: Panel[];
}

// ---------- AI ----------

export interface AiQueryPlan {
  target: QueryTarget;
  connections: string[];
  sql: string;
  dialect: SqlDialect;
  explanation: string;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  sql: string | null;
  connections: string | null;
  rowCount: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}
