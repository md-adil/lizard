// Table-NAME search backing the ⌘K navigation palette (see
// app/api/search/route.ts). Distinct from lib/data/global-search.ts, which
// scans row *content* for Explore — this only filters cached table names and
// merges the labels users actually see (table_overrides), so a search for
// "customers" finds a table an admin renamed from `cust_tbl`.
import type { ConnectionConfig } from "@/lib/types";
import { supportsSchemas } from "@/lib/types";
import { listTableNames } from "@/lib/introspect/table-names";
import { listTableOverridesForConnection } from "@/lib/metadata/store";
import { resolveTableOverride } from "@/lib/introspect/overrides";
import { humanize } from "@/lib/introspect/heuristics";

export interface TableSearchHit {
  connection: string;
  connectionId: string;
  // undefined when the engine has no user-facing schema (MySQL/Mongo) — mirrors
  // TableMeta.schema, so it drops straight into tableHref().
  schema: string | undefined;
  table: string; // raw name, for the URL
  label: string; // override label or humanized name, for display + matching
  isView: boolean;
}

export interface TableSearchResult {
  hits: TableSearchHit[];
  scannedConnections: number;
}

interface Params {
  q: string;
  // startsWith filter on the resolved schema name (the `conn/schema/…` form).
  schema?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

// -1 = no match; higher = better. startsWith beats a mid-string contains, so
// `ord` surfaces `orders` above `work_orders`. An empty query is the scoped
// "show everything here" case (conn/ with no table term) — every table passes
// with a neutral score, ranked alphabetically by the caller.
function matchScore(q: string, name: string, label: string): number {
  if (!q) return 0;
  const inName = name.includes(q);
  const inLabel = label.includes(q);
  if (!inName && !inLabel) return -1;
  if (name.startsWith(q) || label.startsWith(q)) return 2;
  return 1;
}

export async function runTableSearch(connections: ConnectionConfig[], params: Params): Promise<TableSearchResult> {
  const q = params.q.trim().toLowerCase();
  const schemaFilter = params.schema?.trim().toLowerCase();
  const limit = params.limit ?? DEFAULT_LIMIT;

  const scored: { hit: TableSearchHit; score: number }[] = [];

  await Promise.all(
    connections.map(async (conn) => {
      const entries = await listTableNames(conn);
      if (entries.length === 0) return;
      const overrides = listTableOverridesForConnection(conn.id);
      const hasSchema = supportsSchemas(conn.engine);
      for (const e of entries) {
        if (schemaFilter && !e.schema.toLowerCase().startsWith(schemaFilter)) continue;
        const o = resolveTableOverride(overrides, conn.id, e.schema, e.name);
        // Hidden tables are hidden from the sidebar too — keep them out of the
        // palette (searchable=false is deliberately NOT checked: that gates
        // row-content search, not name navigation).
        if (o?.hidden) continue;
        const label = o?.label || humanize(e.name);
        const score = matchScore(q, e.name.toLowerCase(), label.toLowerCase());
        if (score < 0) continue;
        scored.push({
          score,
          hit: {
            connection: conn.name,
            connectionId: conn.id,
            schema: hasSchema ? e.schema : undefined,
            table: e.name,
            label,
            isView: e.kind === "view",
          },
        });
      }
    }),
  );

  scored.sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label));
  return {
    hits: scored.slice(0, limit).map((s) => s.hit),
    scannedConnections: connections.length,
  };
}
