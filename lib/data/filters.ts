// Filter model + safe SQL WHERE construction for the data browser. Column names
// are validated against the table catalog and every value is parameterized;
// operators map to fixed SQL fragments (nothing user-supplied reaches SQL text).
import type { TableInfo } from "@/lib/types";
import { isArrayColumn, arrayElementUdt } from "@/lib/introspect/heuristics";
import type { Dialect } from "@/app/api/database/driver";

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
  | "notnull"
  // Phase 8.6 — richer operators
  | "regex" // case-insensitive POSIX regex (~*)
  | "arraycontains" // array column @> given values (row has all of them)
  | "arrayoverlap" // array column && given values (row has any of them)
  | "jsonbcontains"; // jsonb column @> given JSON (containment)

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
  if (c.op === "in" || c.op === "arraycontains" || c.op === "arrayoverlap")
    return !!c.values && c.values.length > 0;
  return c.value !== undefined && c.value !== "";
}

// sanitized column type for casting text params to the column's type
function castType(table: TableInfo, column: string): string {
  const col = table.columns.find((c) => c.name === column);
  return (col?.udtName ?? "text").replace(/[^a-z0-9_ ]/gi, "") || "text";
}

/**
 * Build a parameterized WHERE clause (without the WHERE keyword) from a set of
 * conditions. `startIndex` is the number of parameters already consumed by the
 * caller so placeholders continue correctly. Unknown columns and incomplete
 * conditions are skipped.
 */
export function buildFilterClause(
  table: TableInfo,
  conditions: FilterCondition[],
  combinator: Combinator,
  dialect: Dialect,
  startIndex = 0
): { clause: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  const push = (v: unknown) => {
    values.push(v);
    return dialect.placeholder(startIndex + values.length);
  };

  for (const f of conditions) {
    if (!table.columns.some((c) => c.name === f.column)) continue;
    if (!isComplete(f)) continue;
    const col = dialect.quoteIdent(f.column);
    const cast = castType(table, f.column);

    switch (f.op) {
      case "null":
        parts.push(`${col} IS NULL`);
        break;
      case "notnull":
        parts.push(`${col} IS NOT NULL`);
        break;
      case "empty":
        parts.push(`(${col} IS NULL OR ${dialect.castToText(col)} = '')`);
        break;
      case "nempty":
        parts.push(`(${col} IS NOT NULL AND ${dialect.castToText(col)} <> '')`);
        break;
      case "contains":
        parts.push(dialect.caseInsensitiveLike(col, push(`%${escapeLike(f.value!, dialect.likeEscapeChar)}%`)));
        break;
      case "ncontains":
        parts.push(`(${col} IS NULL OR NOT ${dialect.caseInsensitiveLike(col, push(`%${escapeLike(f.value!, dialect.likeEscapeChar)}%`))})`);
        break;
      case "startswith":
        parts.push(dialect.caseInsensitiveLike(col, push(`${escapeLike(f.value!, dialect.likeEscapeChar)}%`)));
        break;
      case "endswith":
        parts.push(dialect.caseInsensitiveLike(col, push(`%${escapeLike(f.value!, dialect.likeEscapeChar)}`)));
        break;
      case "eq":
        parts.push(`${dialect.castToText(col)} = ${push(f.value!)}`);
        break;
      case "neq":
        // rows where the column is null count as "not equal"
        parts.push(`(${col} IS NULL OR ${dialect.castToText(col)} <> ${push(f.value!)})`);
        break;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const sym = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op];
        const placeholder = push(f.value!);
        const castExpr = dialect.cast(dialect.castToText(placeholder), cast);
        parts.push(`${col} ${sym} ${castExpr}`);
        break;
      }
      case "between": {
        const a = push(f.value!);
        const b = push(f.value2!);
        const castA = dialect.cast(dialect.castToText(a), cast);
        const castB = dialect.cast(dialect.castToText(b), cast);
        parts.push(`${col} BETWEEN ${castA} AND ${castB}`);
        break;
      }
      case "in": {
        const arr = (f.values ?? []).map(String);
        if (dialect.supportsArrays) {
          parts.push(`${dialect.castToText(col)} = ANY(${push(arr)})`);
        } else {
          parts.push(`${dialect.castToText(col)} IN (${arr.map((val) => push(val)).join(", ")})`);
        }
        break;
      }
      case "regex":
        parts.push(dialect.regexMatch(col, push(f.value!)));
        break;
      case "arraycontains":
      case "arrayoverlap": {
        if (!dialect.supportsArrays) continue;
        const colInfo = table.columns.find((c) => c.name === f.column)!;
        const elemCast = isArrayColumn(colInfo)
          ? arrayElementUdt(colInfo)
          : "text";
        const arr = (f.values ?? []).map(String);
        const sym = f.op === "arraycontains" ? "@>" : "&&";
        parts.push(`${col} ${sym} ${dialect.cast(push(arr), `${elemCast}[]`)}`);
        break;
      }
      case "jsonbcontains":
        if (dialect.engine === "postgres") {
          parts.push(`${col} @> ${dialect.cast(push(f.value!), "jsonb")}`);
        } else if (dialect.engine === "mysql") {
          parts.push(`JSON_CONTAINS(${col}, ${push(f.value!)})`);
        }
        break;
    }
  }

  if (parts.length === 0) return { clause: "", values: [] };
  const glue = combinator === "or" ? " OR " : " AND ";
  return { clause: parts.map((p) => `(${p})`).join(glue), values };
}

// escape LIKE metacharacters in user input for contains/startswith/endswith
function escapeLike(s: string, escapeChar: string): string {
  const re = new RegExp(`[${escapeChar.replace(/\\/g, "\\\\")}%_]`, "g");
  return s.replace(re, (m) => `${escapeChar}${m}`);
}
