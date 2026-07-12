export interface VfkPair {
  from: string; // source column
  to: string; // target column
}

// Constant predicate pinning one side of the relation, e.g. a Laravel
// polymorphic discriminator: source.subject_type = 'App\Models\Course'.
export interface VfkConstant {
  toColumn: string;
  side: "source" | "target";
  value: string; // compared as text
}

export interface VirtualFk {
  id: string;
  // connection id, not name — a name is mutable (rename in Settings), which
  // would silently orphan this relationship if it were the join key instead.
  fromConnection: string;
  fromSchema: string;
  fromTable: string;
  toConnection: string; // connection id, same reasoning
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
  // "pretend" primary key for a table introspection found no PK/unique
  // constraint on (e.g. a Laravel-style pivot table) — lets editing/delete
  // work by giving the client (and the server's existing no-real-key
  // fallback in pkWhere) columns to match a row on. Ignored when the table
  // already has a real PK/unique constraint.
  primaryKey: string[] | null;
  // opts this table into cross-table global search (see lib/data/global-search.ts)
  // — off by default, since scanning every table is the exact unbounded
  // fan-out that feature is designed to avoid.
  searchable: boolean;
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
  redacted: boolean;
  sortOrder: number | null;
  help: string | null;
  // explicit allowed values for a column with no native enum/check
  // constraint — setting this activates the "select" widget even without
  // also setting `widget` explicitly.
  options: string[] | null;
  // raw value -> display label (e.g. "m" -> "Male"), for a column that's
  // enum-like either natively or via `options` above.
  optionLabels: Record<string, string> | null;
}
