// Resolve table/column overrides for a concrete schema.table, honouring schema
// (and table) glob patterns so one override can cover every tenant schema in a
// multi-tenant DB (e.g. store under "org_*" and it applies to org_1, org_2, …).
// Precedence: an exact schema+table match always beats a pattern; among patterns
// the most specific (most non-wildcard characters) wins.
import type { TableOverride, ColumnOverride } from "@/lib/types";
import { matchesGlob } from "./virtual-fk";

// -1 = no match; higher = better. Exact schema scores far above any pattern.
function schemaScore(pattern: string, schema: string): number {
  if (pattern === schema) return 10_000;
  if (matchesGlob(pattern, schema)) return pattern.replace(/[*?]/g, "").length;
  return -1;
}

function tableMatches(pattern: string, table: string): boolean {
  return pattern === table || matchesGlob(pattern, table);
}

export function resolveTableOverride(
  all: TableOverride[],
  connectionId: string,
  schema: string,
  table: string,
): TableOverride | null {
  let best: TableOverride | null = null;
  let bestScore = -1;
  for (const o of all) {
    if (o.connectionId !== connectionId) continue;
    if (!tableMatches(o.table, table)) continue;
    const sc = schemaScore(o.schema, schema);
    if (sc > bestScore) {
      best = o;
      bestScore = sc;
    }
  }
  return best;
}

// One effective override per column (best-scoring wins per column).
export function resolveColumnOverrides(
  all: ColumnOverride[],
  connectionId: string,
  schema: string,
  table: string,
): ColumnOverride[] {
  const byCol = new Map<string, { o: ColumnOverride; score: number }>();
  for (const o of all) {
    if (o.connectionId !== connectionId) continue;
    if (!tableMatches(o.table, table)) continue;
    const sc = schemaScore(o.schema, schema);
    if (sc < 0) continue;
    const cur = byCol.get(o.column);
    if (!cur || sc > cur.score) byCol.set(o.column, { o, score: sc });
  }
  return [...byCol.values()].map((v) => v.o);
}
