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
  side: "source" | "target";
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
  redacted: boolean;
  sortOrder: number | null;
  help: string | null;
}
