// Filter model + safe SQL WHERE construction for the data browser. Column names
// are validated against the table catalog and every value is parameterized;
// operators map to fixed SQL fragments (nothing user-supplied reaches SQL text).
import type { TableInfo } from "@/lib/types";

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "ncontains"
  | "startswith"
  | "endswith"
  | "between"
  | "in"
  | "empty"
  | "nempty"
  | "null"
  | "notnull";

export interface FilterCondition {
  column: string;
  op: FilterOp;
  value?: string; // primary operand
  value2?: string; // upper bound for "between"
  values?: string[]; // operands for "in"
}

export type Combinator = "and" | "or";

export interface FilterSet {
  combinator: Combinator;
  conditions: FilterCondition[];
}

// operators that need no value at all
export const NO_VALUE_OPS: FilterOp[] = ["empty", "nempty", "null", "notnull"];

export function isComplete(c: FilterCondition): boolean {
  if (NO_VALUE_OPS.includes(c.op)) return true;
  if (c.op === "between") return !!c.value && c.value !== "" && !!c.value2 && c.value2 !== "";
  if (c.op === "in") return !!c.values && c.values.length > 0;
  return c.value !== undefined && c.value !== "";
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// sanitized column type for casting text params to the column's type
function castType(table: TableInfo, column: string): string {
  const col = table.columns.find((c) => c.name === column);
  return (col?.udtName ?? "text").replace(/[^a-z0-9_ ]/gi, "") || "text";
}

/**
 * Build a parameterized WHERE clause (without the WHERE keyword) from a set of
 * conditions. `startIndex` is the number of $-parameters already consumed by the
 * caller so placeholders continue correctly. Unknown columns and incomplete
 * conditions are skipped.
 */
export function buildFilterClause(
  table: TableInfo,
  conditions: FilterCondition[],
  combinator: Combinator,
  startIndex = 0
): { clause: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  const push = (v: unknown) => {
    values.push(v);
    return `$${startIndex + values.length}`;
  };

  for (const f of conditions) {
    if (!table.columns.some((c) => c.name === f.column)) continue;
    if (!isComplete(f)) continue;
    const col = q(f.column);
    const cast = castType(table, f.column);

    switch (f.op) {
      case "null":
        parts.push(`${col} IS NULL`);
        break;
      case "notnull":
        parts.push(`${col} IS NOT NULL`);
        break;
      case "empty":
        parts.push(`(${col} IS NULL OR ${col}::text = '')`);
        break;
      case "nempty":
        parts.push(`(${col} IS NOT NULL AND ${col}::text <> '')`);
        break;
      case "contains":
        parts.push(`${col}::text ILIKE ${push(`%${escapeLike(f.value!)}%`)}`);
        break;
      case "ncontains":
        parts.push(`(${col} IS NULL OR ${col}::text NOT ILIKE ${push(`%${escapeLike(f.value!)}%`)})`);
        break;
      case "startswith":
        parts.push(`${col}::text ILIKE ${push(`${escapeLike(f.value!)}%`)}`);
        break;
      case "endswith":
        parts.push(`${col}::text ILIKE ${push(`%${escapeLike(f.value!)}`)}`);
        break;
      case "eq":
        parts.push(`${col}::text = ${push(f.value!)}`);
        break;
      case "neq":
        // rows where the column is null count as "not equal"
        parts.push(`(${col} IS NULL OR ${col}::text <> ${push(f.value!)})`);
        break;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const sym = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op];
        parts.push(`${col} ${sym} ${push(f.value!)}::text::${cast}`);
        break;
      }
      case "between": {
        const a = push(f.value!);
        const b = push(f.value2!);
        parts.push(`${col} BETWEEN ${a}::text::${cast} AND ${b}::text::${cast}`);
        break;
      }
      case "in": {
        const arr = (f.values ?? []).map(String);
        parts.push(`${col}::text = ANY(${push(arr)})`);
        break;
      }
    }
  }

  if (parts.length === 0) return { clause: "", values: [] };
  const glue = combinator === "or" ? " OR " : " AND ";
  return { clause: parts.map((p) => `(${p})`).join(glue), values };
}

// escape LIKE metacharacters in user input for contains/startswith/endswith
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
