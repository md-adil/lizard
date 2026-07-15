// Translate Lizard's engine-agnostic FilterCondition[] into a MongoDB query
// filter. The relational path builds a parameterized SQL WHERE (lib/data/
// filters.ts); this is its document-store twin. Column names are validated
// against the sampled catalog by the caller, operators map to a fixed set of
// Mongo query operators (nothing user-supplied becomes an operator or a
// `$where`/`$function` — that keeps the read path safe by construction), and
// values are coerced to the field's sampled BSON type.
import type { TableInfo } from "@/lib/types";
import type { FilterCondition, Combinator } from "@/lib/data/filters";
import { coerceId } from "./bson";

type MongoFilter = Record<string, unknown>;

// Escape regex metacharacters so a `contains`/`startswith`/`endswith` value is
// matched literally, never interpreted as a pattern. Exported for reuse by
// search.ts's global-search word-start matching.
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Coerce a client-supplied filter value (usually a string) to the BSON type the
// field stores, so comparisons hit the right type. Booleans/numbers already
// arrive typed from the client for those columns. Exported for reuse by
// search.ts's exact-match global-search lookups (e.g. an ObjectId _id term).
export function coerceValue(table: TableInfo, column: string, value: unknown): unknown {
  const col = table.columns.find((c) => c.name === column);
  const udt = col?.udtName;
  if (column === "_id" || udt === "objectid") return coerceId(value);
  if (udt === "timestamp" || udt === "date") {
    return typeof value === "string" || typeof value === "number" ? new Date(value) : value;
  }
  if ((udt === "int4" || udt === "int8") && typeof value === "string" && value.trim() !== "") {
    return Math.trunc(Number(value));
  }
  if ((udt === "float8" || udt === "numeric") && typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }
  if (udt === "bool") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return value;
}

import { isComplete } from "@/lib/data/filters";

// Build a per-condition Mongo filter fragment, or null to skip it.
function conditionToMongo(table: TableInfo, f: FilterCondition): MongoFilter | null {
  if (!table.columns.some((c) => c.name === f.column)) return null;
  if (!isComplete(f)) return null;
  const col = f.column;
  const val = (v: unknown = f.value) => coerceValue(table, col, v);

  switch (f.op) {
    case "eq":
      return { [col]: val() };
    case "neq":
      return { [col]: { $ne: val() } };
    case "gt":
      return { [col]: { $gt: val() } };
    case "gte":
      return { [col]: { $gte: val() } };
    case "lt":
      return { [col]: { $lt: val() } };
    case "lte":
      return { [col]: { $lte: val() } };
    case "between":
      return { [col]: { $gte: val(f.value), $lte: val(f.value2) } };
    case "in":
      return { [col]: { $in: (f.values ?? []).map((v) => val(v)) } };
    case "contains":
      return { [col]: { $regex: escapeRegex(String(f.value)), $options: "i" } };
    case "ncontains":
      return { [col]: { $not: { $regex: escapeRegex(String(f.value)), $options: "i" } } };
    case "startswith":
      return { [col]: { $regex: `^${escapeRegex(String(f.value))}`, $options: "i" } };
    case "endswith":
      return { [col]: { $regex: `${escapeRegex(String(f.value))}$`, $options: "i" } };
    case "regex":
      // The value is an intentional pattern here; still bounded by maxTimeMS.
      return { [col]: { $regex: String(f.value), $options: "i" } };
    case "null":
      return { [col]: null }; // matches null or missing
    case "notnull":
      return { [col]: { $ne: null } };
    case "empty":
      return { $or: [{ [col]: null }, { [col]: "" }] };
    case "nempty":
      return { [col]: { $nin: [null, ""] } };
    case "arraycontains":
      return { [col]: { $all: (f.values ?? []).map((v) => val(v)) } };
    case "arrayoverlap":
      return { [col]: { $in: (f.values ?? []).map((v) => val(v)) } };
    // jsonbcontains has no clean single-field Mongo equivalent — skip rather
    // than emit something surprising.
    case "jsonbcontains":
      return null;
    default:
      return null;
  }
}

export function buildMongoFilter(
  table: TableInfo,
  conditions: FilterCondition[],
  combinator: Combinator,
): MongoFilter {
  const parts = conditions
    .map((c) => conditionToMongo(table, c))
    .filter((p): p is MongoFilter => p !== null);
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return combinator === "or" ? { $or: parts } : { $and: parts };
}

// Combine a filter and a search fragment with AND (both must hold).
export function andFilters(...parts: (MongoFilter | null)[]): MongoFilter {
  const present = parts.filter((p): p is MongoFilter => p != null && Object.keys(p).length > 0);
  if (present.length === 0) return {};
  if (present.length === 1) return present[0];
  return { $and: present };
}
