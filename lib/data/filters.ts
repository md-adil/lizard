// Filter model + safe SQL WHERE construction for the data browser. Column names
// are validated against the table catalog and every value is parameterized;
// operators map to fixed SQL fragments (nothing user-supplied reaches SQL text).
import type { TableInfo } from "@/lib/types";
import { isArrayColumn, arrayElementUdt, NUMERIC_UDTS } from "@/lib/introspect/heuristics";
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
  // primary operand — boolean for real boolean columns (incl. MySQL's
  // tinyint(1), normalized to the "bool" udtName), number for numeric
  // columns, string otherwise.
  value?: string | boolean | number;
  value2?: string | number; // upper bound for "between"
  values?: string[]; // operands for "in"
}

export type Combinator = "and" | "or";

export interface FilterSet {
  combinator: Combinator;
  conditions: FilterCondition[];
}

// operators that need no value at all
export const NO_VALUE_OPS: FilterOp[] = ["empty", "nempty", "null", "notnull"];

// `!value` would treat a numeric 0 as missing — a real value is only ever
// absent (undefined) or the empty string, never falsy-but-present.
function isEmptyValue(v: string | boolean | number | undefined): boolean {
  return v === undefined || v === "";
}

export function isComplete(c: FilterCondition): boolean {
  if (NO_VALUE_OPS.includes(c.op)) return true;
  if (c.op === "between") return !isEmptyValue(c.value) && !isEmptyValue(c.value2);
  if (c.op === "in" || c.op === "arraycontains" || c.op === "arrayoverlap")
    return !!c.values && c.values.length > 0;
  return !isEmptyValue(c.value);
}

// sanitized column type for casting text params to the column's type
function castType(table: TableInfo, column: string): string {
  const col = table.columns.find((c) => c.name === column);
  return (col?.udtName ?? "text").replace(/[^a-z0-9_ ]/gi, "") || "text";
}

// Whether a value already carries the column's native JS type, so it can be
// bound as-is instead of round-tripping through a text SQL cast. Two cases
// care about this:
//  - booleans: MySQL's tinyint(1) (normalized to the "bool" udtName) has no
//    boolean CAST target, and CAST('true'/'false' AS SIGNED) can't parse
//    either word (silently coercing both to 0) — the client sends a real
//    JS boolean for these columns instead.
//  - numbers: a numeric column compared against a CAST(CAST($1 AS CHAR) AS
//    DECIMAL)-wrapped text parameter is needless indirection once the value
//    is already numeric; binding it natively keeps the parameter a plain
//    number, which every driver can index/plan against directly.
function bindsNative(cast: string, value: unknown): boolean {
  return (cast === "bool" && typeof value === "boolean") || (NUMERIC_UDTS.has(cast) && typeof value === "number");
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
  startIndex = 0,
  // "tag" widget columns store a JSON array (jsonb/json, or JSON text in a
  // plain text/varchar column per widgetOverrideColumns in lib/data/crud.ts)
  // rather than a native SQL array — arraycontains/arrayoverlap need each
  // engine's JSON functions/operators for these instead of @>/&&.
  tagColumns: Set<string> = new Set()
): { clause: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  const push = (v: unknown) => {
    values.push(v);
    return dialect.placeholder(startIndex + values.length);
  };
  // binds a value natively when it's already the column's native JS type
  // (see bindsNative above), otherwise falls back to the text-cast round-trip.
  const bindOrCast = (cast: string, raw: unknown) =>
    bindsNative(cast, raw) ? push(raw) : dialect.cast(dialect.castToText(push(String(raw))), cast);

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
        parts.push(dialect.caseInsensitiveLike(col, push(`%${escapeLike(f.value as string, dialect.likeEscapeChar)}%`)));
        break;
      case "ncontains":
        parts.push(`(${col} IS NULL OR NOT ${dialect.caseInsensitiveLike(col, push(`%${escapeLike(f.value as string, dialect.likeEscapeChar)}%`))})`);
        break;
      case "startswith":
        parts.push(dialect.caseInsensitiveLike(col, push(`${escapeLike(f.value as string, dialect.likeEscapeChar)}%`)));
        break;
      case "endswith":
        parts.push(dialect.caseInsensitiveLike(col, push(`%${escapeLike(f.value as string, dialect.likeEscapeChar)}`)));
        break;
      // Cast the *parameter* to the column's type, never the column: wrapping
      // the column (`col::text = $1`) is not sargable, so the planner ignores
      // its index and scans the table. Casting a bound constant is free — the
      // planner folds it. Same shape as the gt/lt/between cases below.
      //
      // bindOrCast binds booleans/numbers natively (see bindsNative above)
      // and only falls back to the text-cast round-trip for values that
      // aren't already the column's native type.
      case "eq":
        parts.push(`${col} = ${bindOrCast(cast, f.value)}`);
        break;
      case "neq":
        // rows where the column is null count as "not equal"
        parts.push(`(${col} IS NULL OR ${col} <> ${bindOrCast(cast, f.value)})`);
        break;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const sym = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op];
        parts.push(`${col} ${sym} ${bindOrCast(cast, f.value)}`);
        break;
      }
      case "between": {
        const castA = bindOrCast(cast, f.value);
        const castB = bindOrCast(cast, f.value2);
        parts.push(`${col} BETWEEN ${castA} AND ${castB}`);
        break;
      }
      case "in": {
        const arr = (f.values ?? []).map(String);
        if (dialect.supportsArrays) {
          // `col = ANY($1::int4[])` — the array literal is cast, not the column.
          parts.push(`${col} = ANY(${dialect.cast(push(arr), `${cast}[]`)})`);
        } else {
          parts.push(
            `${col} IN (${arr.map((val) => dialect.cast(dialect.castToText(push(val)), cast)).join(", ")})`,
          );
        }
        break;
      }
      case "regex":
        parts.push(dialect.regexMatch(col, push(f.value!)));
        break;
      case "arraycontains":
      case "arrayoverlap": {
        const arr = (f.values ?? []).map(String);
        if (tagColumns.has(f.column)) {
          if (dialect.engine === "postgres") {
            // ?& / ?| take a text[] of top-level array elements to check for.
            const sym = f.op === "arraycontains" ? "?&" : "?|";
            parts.push(`${dialect.cast(col, "jsonb")} ${sym} ${dialect.cast(push(arr), "text[]")}`);
          } else if (dialect.engine === "mysql") {
            // meta_tags-style columns are often plain TEXT/VARCHAR (not a
            // native JSON column) carrying legacy data that predates the
            // "tag" widget — JSON_CONTAINS/JSON_OVERLAPS throw on a row
            // whose value isn't valid JSON instead of just not matching, so
            // gate on JSON_VALID first (MySQL short-circuits AND per-row).
            const fn = f.op === "arraycontains" ? "JSON_CONTAINS" : "JSON_OVERLAPS";
            parts.push(`(JSON_VALID(${col}) AND ${fn}(${col}, ${push(JSON.stringify(arr))}))`);
          }
          break;
        }
        if (!dialect.supportsArrays) continue;
        const colInfo = table.columns.find((c) => c.name === f.column)!;
        const elemCast = isArrayColumn(colInfo)
          ? arrayElementUdt(colInfo)
          : "text";
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
export function escapeLike(s: string, escapeChar: string): string {
  const re = new RegExp(`[${escapeChar.replace(/\\/g, "\\\\")}%_]`, "g");
  return s.replace(re, (m) => `${escapeChar}${m}`);
}
