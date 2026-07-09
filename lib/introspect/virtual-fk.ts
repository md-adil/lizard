// Pure helpers for the virtual-FK model, shared by client (useTableMeta,
// table-customizer) and server (crud resolver, AI serialization). No SQL/I/O.
import picomatch from "picomatch";
import type { VirtualFk, VfkTransform } from "@/lib/types";

// Sentinel target schema meaning "same schema as the source row" — the
export const SAME_SCHEMA = "$schema";

// Glob matching via picomatch (the battle-tested core under micromatch/glob).
// Schema/table names have no "/", so `*`/`?` behave as expected; compiled
// matchers are memoized since the same patterns recur across every row/vfk.
const matcherCache = new Map<string, (value: string) => boolean>();
function matcherFor(pattern: string): (value: string) => boolean {
  let m = matcherCache.get(pattern);
  if (!m) {
    m = picomatch(pattern, { dot: true });
    matcherCache.set(pattern, m);
  }
  return m;
}

export function matchesGlob(pattern: string, value: string): boolean {
  return pattern === value || matcherFor(pattern)(value);
}

export function isPattern(s: string): boolean {
  return picomatch.scan(s).isGlob;
}

// Does this virtual FK apply when browsing connection.schema.table?
export function vfkMatchesSource(v: VirtualFk, connection: string, schema: string, table: string): boolean {
  return v.fromConnection === connection && matchesGlob(v.fromSchema, schema) && matchesGlob(v.fromTable, table);
}

// Concrete target schema for a source row in `sourceSchema`.
export function resolveToSchema(v: VirtualFk, sourceSchema: string): string {
  return v.toSchema === SAME_SCHEMA ? sourceSchema : v.toSchema;
}

// The source column that renders as a reference / keys the label map.
export function vfkDisplayColumn(v: VirtualFk): string | undefined {
  return v.pairs[0]?.from;
}

// The primary target column (reference picker searches against this).
export function vfkTargetColumn(v: VirtualFk): string | undefined {
  return v.pairs[0]?.to;
}

// Normalize a source value in JS to mirror the SQL transform on the target,
// so tuple keys computed on both sides line up.
//
// Always returns text, and that is the point: lower/upper/trim are text
// operations, and the target side is compared as text to match. Callers on an
// indexed path (a plain, untransformed key lookup) must NOT route values
// through here — stringifying an integer key would defeat its index. Guard
// with a `transform && transform !== "none"` check and bind the raw value
// otherwise.
export function applyTransform(value: unknown, t: VfkTransform = "none"): string {
  const s = String(value);
  switch (t) {
    case "lower":
      return s.toLowerCase();
    case "upper":
      return s.toUpperCase();
    case "trim":
      return s.trim();
    default:
      return s;
  }
}

// Compact human summary, e.g. "user_id → billing.$schema.customers.id (lower)".
export function vfkSummary(v: VirtualFk): string {
  const pairs = v.pairs
    .map((p) => `${p.from} = ${p.to}${p.transform && p.transform !== "none" ? ` [${p.transform}]` : ""}`)
    .join(", ");
  const consts = v.constants
    .map((c) => {
      const tbl = c.side === "source" ? v.fromTable : v.toTable;
      return `${tbl}.${c.toColumn}='${c.value}'`;
    })
    .join(", ");
  const target = `${v.toConnection}.${v.toSchema}.${v.toTable}`;
  return [`${target} ON ${pairs}`, consts ? `WHERE ${consts}` : "", v.joinHint ? `HINT: ${v.joinHint}` : ""]
    .filter(Boolean)
    .join(" ");
}
