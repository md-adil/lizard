// UI heuristics derived from the schema model (§5.1). Overrides refine these;
// nothing here is mandatory config.
import type { ColumnInfo, TableInfo } from "@/lib/types";

export type Widget =
  | "text"
  | "textarea"
  | "number"
  | "toggle"
  | "date"
  | "datetime"
  | "select"
  | "json"
  | "reference"
  | "readonly";

const NUMERIC_UDTS = new Set([
  "int2",
  "int4",
  "int8",
  "float4",
  "float8",
  "numeric",
  "money",
  "oid",
]);
const READONLY_NAME_PATTERNS =
  /^(created_at|updated_at|inserted_at|modified_at)$/i;
const DISPLAY_NAME_CANDIDATES = [
  "name",
  "title",
  "label",
  "email",
  "username",
  "slug",
];

export function guessDisplayColumn(table: TableInfo): string | null {
  const cols = table.columns;
  for (const cand of DISPLAY_NAME_CANDIDATES) {
    const hit = cols.find((c) => c.name.toLowerCase() === cand);
    if (hit) return hit.name;
  }
  const firstText = cols.find(
    (c) =>
      ["text", "varchar", "bpchar"].includes(c.udtName) &&
      !table.primaryKey.includes(c.name),
  );
  if (firstText) return firstText.name;
  return table.primaryKey[0] ?? cols[0]?.name ?? null;
}

export function guessWidget(table: TableInfo, col: ColumnInfo): Widget {
  if (col.isGenerated) return "readonly";
  if (READONLY_NAME_PATTERNS.test(col.name)) return "readonly";
  // serial/identity PKs are db-assigned
  if (table.primaryKey.includes(col.name) && col.default?.includes("nextval"))
    return "readonly";

  if (
    table.foreignKeys.some(
      (fk) => fk.columns.length === 1 && fk.columns[0] === col.name,
    )
  )
    return "reference";
  if (col.enumValues && col.enumValues.length > 0) return "select";
  const check = table.checkConstraints.find(
    (c) => c.inColumn === col.name && c.inValues,
  );
  if (check) return "select";

  if (col.udtName === "bool") return "toggle";
  if (col.udtName === "date") return "date";
  if (col.udtName.startsWith("timestamp")) return "datetime";
  if (["json", "jsonb"].includes(col.udtName)) return "json";
  if (NUMERIC_UDTS.has(col.udtName)) return "number";
  if (col.udtName === "text" && (col.maxLength === null || col.maxLength > 255))
    return "textarea";
  return "text";
}

export function selectOptions(
  table: TableInfo,
  col: ColumnInfo,
): string[] | null {
  if (col.enumValues && col.enumValues.length > 0) return col.enumValues;
  const check = table.checkConstraints.find(
    (c) => c.inColumn === col.name && c.inValues,
  );
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
const UPDATED_AT_RE =
  /^(last_?)?(updated|modified|changed)(_at|_date|_on|_time|_ts)?$/i;
const TIMESTAMP_TYPES = new Set(["timestamp", "timestamptz"]);

/** Returns the name of the first timestamp column that looks like an
 *  "updated at" marker, or `null` if none is found. */
export function findUpdatedAtColumn(columns: ColumnInfo[]): string | null {
  return (
    columns.find(
      (c) => TIMESTAMP_TYPES.has(c.udtName) && UPDATED_AT_RE.test(c.name),
    )?.name ?? null
  );
}
