// UI heuristics derived from the schema model (§5.1). Overrides refine these;
// nothing here is mandatory config.
import type { ColumnInfo, TableInfo } from "@/lib/types";
import { Widget } from "../data/widgets";
export type { Widget };

export const NUMERIC_UDTS = new Set(["int2", "int4", "int8", "float4", "float8", "numeric", "money", "oid"]);
// Columns whose native JS type is already a string, so a JS string needs no
// SQL cast to be compared against one. MySQL's text types all normalize into
// this set (varchar/char → "varchar", the four TEXT sizes → "text"); Postgres
// enums keep their own type name and are deliberately absent, since a string
// still has to be cast to reach them.
export const TEXT_UDTS = new Set(["varchar", "text", "bpchar", "char", "name", "citext", "enum"]);
const RANGE_UDTS = new Set([
  "int4range",
  "int8range",
  "numrange",
  "tsrange",
  "tstzrange",
  "daterange",
  "int4multirange",
  "int8multirange",
  "nummultirange",
  "tsmultirange",
  "tstzmultirange",
  "datemultirange",
]);
const NETWORK_UDTS = new Set(["inet", "cidr", "macaddr", "macaddr8"]);

// Postgres array columns report data_type = "ARRAY" and udt_name = "_<elem>"
// (e.g. "_int4" for int[]). Element udt is the name minus the leading "_".
export function isArrayColumn(col: ColumnInfo): boolean {
  return col.dataType === "ARRAY" || col.udtName.startsWith("_");
}
export function arrayElementUdt(col: ColumnInfo): string {
  return col.udtName.startsWith("_") ? col.udtName.slice(1) : col.udtName;
}
const READONLY_NAME_PATTERNS = /^(created_at|updated_at|inserted_at|modified_at)$/i;
const REDACTED_NAME_PATTERNS = /password|passwd|pwd|secret|token|api_key|apikey|access_key|private_key|credential/i;
const DISPLAY_NAME_CANDIDATES = ["name", "title", "label", "email", "username", "slug"];

// A table's real primary key if it has one, otherwise its first unique
// constraint — Laravel-style pivot tables (user_id, post_id, no declared PK)
// commonly have a unique composite index instead. Returns [] if neither
// exists, meaning no single row can be reliably targeted for edit/delete.
export function effectiveKey(table: TableInfo): string[] {
  if (table.primaryKey.length > 0) return table.primaryKey;
  return table.uniqueConstraints[0] ?? [];
}

export function guessDisplayColumn(table: TableInfo): string | null {
  const cols = table.columns;
  for (const cand of DISPLAY_NAME_CANDIDATES) {
    const hit = cols.find((c) => c.name.toLowerCase() === cand);
    if (hit) return hit.name;
  }
  const key = effectiveKey(table);
  const firstText = cols.find((c) => ["text", "varchar", "bpchar"].includes(c.udtName) && !key.includes(c.name));
  if (firstText) return firstText.name;
  return key[0] ?? cols[0]?.name ?? null;
}

export function guessReadonly(table: TableInfo, col: ColumnInfo): boolean {
  if (col.isGenerated) return true;
  if (READONLY_NAME_PATTERNS.test(col.name)) return true;
  return false;
}

// Whether a column looks like it holds a secret (password/token/api key/...)
// and should default to masked display absent an explicit override.
export function guessRedacted(col: ColumnInfo): boolean {
  return REDACTED_NAME_PATTERNS.test(col.name);
}

export function guessWidget(table: TableInfo, col: ColumnInfo): Widget {
  // A single-column FK is flagged via ColumnMeta.ref (see useTableMeta.tsx),
  // not a dedicated widget — every consumer that cares already checks `ref`,
  // so the column just gets its normal type-based widget here.
  if (col.enumValues && col.enumValues.length > 0) return "select";
  const check = table.checkConstraints.find((c) => c.inColumn === col.name && c.inValues);
  if (check) return "select";

  // arrays first — an array's udt_name ("_int4") would otherwise fall through
  if (isArrayColumn(col)) return "array";
  if (col.udtName === "bool") return "toggle";
  if (col.udtName === "date") return "date";
  if (col.udtName.startsWith("timestamp")) return "datetime";
  if (["json", "jsonb"].includes(col.udtName)) return "json";
  if (col.udtName === "uuid") return "uuid";
  if (col.udtName === "bytea") return "bytea";
  if (col.udtName === "interval") return "interval";
  if (RANGE_UDTS.has(col.udtName)) return "range";
  if (NETWORK_UDTS.has(col.udtName)) return "network";
  if (NUMERIC_UDTS.has(col.udtName)) return "number";
  if (col.udtName === "text" && (col.maxLength === null || col.maxLength > 255)) return "textarea";
  return "text";
}

export function selectOptions(table: TableInfo, col: ColumnInfo): string[] | null {
  if (col.enumValues && col.enumValues.length > 0) return col.enumValues;
  const check = table.checkConstraints.find((c) => c.inColumn === col.name && c.inValues);
  return check?.inValues ?? null;
}

// Humanize a snake_case identifier into a label.
export function humanize(identifier: string): string {
  return identifier
    .replace(/_id$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Common name patterns for "last updated" timestamp columns.
const UPDATED_AT_RE = /^(last_?)?(updated|modified|changed)(_at|_date|_on|_time|_ts)?$/i;
const TIMESTAMP_TYPES = new Set(["timestamp", "timestamptz"]);

/** Returns the name of the first timestamp column that looks like an
 *  "updated at" marker, or `null` if none is found. */
export function findUpdatedAtColumn(columns: ColumnInfo[]): string | null {
  return columns.find((c) => TIMESTAMP_TYPES.has(c.udtName) && UPDATED_AT_RE.test(c.name))?.name ?? null;
}
