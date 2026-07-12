// Cross-table global search. Scope is bounded by construction, not
// cleverness: only tables an admin has opted into (`table_overrides.searchable`)
// are ever queried, and each is searched only on its *indexed* columns via
// lib/data/search-match.ts (shared with the per-table search box in
// lib/data/crud.ts) — never an unindexed column, since that's exactly the
// full-scan cost this feature is built to avoid. See the plan this shipped
// under for the full rationale.
import { randomUUID } from "node:crypto";
import { LRUCache } from "lru-cache";
import { supportsSchemas, type ConnectionCatalog, type ConnectionConfig, type TableInfo } from "@/lib/types";
import { effectiveKey } from "@/lib/introspect/heuristics";
import { resolveTableOverride } from "@/lib/introspect/overrides";
import { getConnection, listTableOverridesForConnection } from "@/lib/metadata/store";
import { getDialect } from "@/app/api/database/registry";
import { getClient } from "@/lib/db/pools";
import { matchTargetFor, buildMatchClause, matchesTerm } from "@/lib/data/search-match";
import { primaryKeyColumnsFor } from "@/lib/data/crud";

export interface GlobalSearchHit {
  connection: string; // connection name, for routing/display
  schema: string | undefined; // undefined for engines without schemas (MySQL)
  table: string;
  matchedColumn: string;
  value: string;
  pk: Record<string, unknown>;
}

export interface GlobalSearchResult {
  hits: GlobalSearchHit[];
  scannedTables: number;
  skippedTables: number;
  partial: boolean;
}

const PER_TABLE_LIMIT = 5;
const TOTAL_HIT_LIMIT = 50;
const CONCURRENCY = 8;

// A searchable-table target, resolved independently of any search term — the
// expensive part of a search (resolveTableOverride against every table of
// every schema) doesn't depend on what's being typed, so it's wasteful to
// redo on every debounced keystroke. The client resolves this once, when the
// search dialog opens (createSearchSession), and passes the returned session
// id back on every keystroke's search call instead of a blind time-based
// cache — see app/api/search/session/route.ts and app/api/search/route.ts.
interface SearchTarget {
  conn: ConnectionConfig;
  schemaName: string | undefined;
  table: TableInfo;
}

// Safety net for dialogs left open (or abandoned mid-session): a 10-minute
// TTL, and a generous max entry count so this can't grow unbounded under
// concurrent users — both handled by the library rather than a hand-rolled
// sweep, since that's exactly what an LRU-with-TTL cache is for.
const sessions = new LRUCache<string, SearchTarget[]>({ max: 500, ttl: 10 * 60_000 });

// A `searchable` override write invalidates every open session's resolved
// list — cheap to blow away entirely (each rebuilds on its next dialog-open)
// rather than track which sessions it actually affects.
export function invalidateSearchTargets(): void {
  sessions.clear();
}

function resolveSearchTargets(connections: ConnectionCatalog[]): SearchTarget[] {
  const targets: SearchTarget[] = [];
  for (const cc of connections) {
    if (cc.engine === "mongo" || cc.error) continue; // no Dialect/SQL to build against
    const conn = getConnection(cc.connectionId);
    if (!conn) continue;
    const overrides = listTableOverridesForConnection(cc.connectionId);
    const hasSchemas = supportsSchemas(cc.engine);
    for (const schema of cc.schemas) {
      for (const table of schema.tables) {
        const ov = resolveTableOverride(overrides, cc.connectionId, schema.name, table.name);
        if (!ov?.searchable) continue;
        targets.push({ conn, schemaName: hasSchemas ? schema.name : undefined, table });
      }
    }
  }
  return targets;
}

// Called once when the search dialog opens (see app/api/search/session/route.ts).
export function createSearchSession(connections: ConnectionCatalog[]): { sessionId: string; scannedTables: number } {
  const targets = resolveSearchTargets(connections);
  const sessionId = randomUUID();
  sessions.set(sessionId, targets);
  return { sessionId, scannedTables: targets.length };
}

async function searchOneTable(
  conn: ConnectionConfig,
  schemaName: string | undefined,
  table: TableInfo,
  term: string,
): Promise<GlobalSearchHit[]> {
  const key = effectiveKey(table);
  if (key.length === 0) return []; // no PK/unique constraint — can't link back to a row

  const target = matchTargetFor(table, term, primaryKeyColumnsFor(conn, table));
  if (target.columns.length === 0) return [];

  const dialect = getDialect(conn.engine);
  const values: unknown[] = [];
  const whereSql = buildMatchClause(target, term, values, dialect);
  const fqtn = dialect.supportsSchemas
    ? `${dialect.quoteIdent(table.schema)}.${dialect.quoteIdent(table.name)}`
    : dialect.quoteIdent(table.name);
  const selectCols = [...new Set([...key, ...target.columns.map((c) => c.col.name)])];
  const sql = `SELECT ${selectCols.map((c) => dialect.quoteIdent(c)).join(", ")} FROM ${fqtn} WHERE ${whereSql} LIMIT ${PER_TABLE_LIMIT}`;

  const client = await getClient(conn, "read");
  try {
    const res = await client.query(sql, values);
    return res.rows.map((row) => {
      const pk: Record<string, unknown> = {};
      for (const k of key) pk[k] = row[k];
      // Which candidate column actually satisfied the WHERE — checked the
      // same rule the SQL used (after stringifying non-text values), NOT
      // "first non-null column": a non-null PK/id column would otherwise
      // always win that race regardless of whether it was the one that
      // actually matched, mislabeling a real text match (e.g. a name
      // column) as if the row had matched on its numeric id.
      const matchedColumn =
        target.columns.find(({ col, mode }) => matchesTerm(String(row[col.name] ?? ""), term, mode))?.col.name ??
        target.columns[0].col.name;
      return {
        connection: conn.name,
        schema: schemaName,
        table: table.name,
        matchedColumn,
        value: String(row[matchedColumn] ?? ""),
        pk,
      };
    });
  } finally {
    client.release();
  }
}

// Concurrency-limited worker pool with an overall wall-clock deadline. A
// slow/hung table only costs the wait, not the whole search — the
// underlying DB query isn't cancelled at the driver level, just no longer
// waited on; the pooled client still releases normally whenever it resolves.
async function runWithBudget<T>(
  tasks: (() => Promise<T[]>)[],
  concurrency: number,
  deadline: number,
): Promise<{ results: T[]; skipped: number }> {
  const results: T[] = [];
  let skipped = 0;
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      if (Date.now() >= deadline) {
        skipped += tasks.length - i;
        i = tasks.length;
        return;
      }
      const task = tasks[i++];
      const remaining = deadline - Date.now();
      try {
        const r = await Promise.race([
          task(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("search timeout")), remaining)),
        ]);
        results.push(...r);
      } catch {
        skipped++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return { results, skipped };
}

// `connections` should already be filtered to what the requesting user can
// read (see readableConnectionIds) — this function has no access-control
// opinion of its own. `sessionId` should come from createSearchSession
// (called once when the search dialog opens); a missing/expired/unknown one
// falls back to resolving fresh rather than failing the search outright.
export async function runGlobalSearch(
  connections: ConnectionCatalog[],
  term: string,
  sessionId: string | undefined,
  budgetMs = 4000,
): Promise<GlobalSearchResult> {
  const deadline = Date.now() + budgetMs;
  const targets = (sessionId ? sessions.get(sessionId) : undefined) ?? resolveSearchTargets(connections);
  const tasks = targets.map((t) => () => searchOneTable(t.conn, t.schemaName, t.table, term));

  const { results, skipped } = await runWithBudget(tasks, CONCURRENCY, deadline);
  return {
    hits: results.slice(0, TOTAL_HIT_LIMIT),
    scannedTables: targets.length,
    skippedTables: skipped,
    partial: skipped > 0,
  };
}
