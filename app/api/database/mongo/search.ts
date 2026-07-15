// Cross-table global search's Mongo counterpart (see lib/data/global-search.ts,
// which owns table-eligibility/session/budget logic and dispatches the actual
// per-table query by engine). Column selection and match-mode (exact vs
// word-start) are engine-agnostic — lib/data/search-match.ts's matchTargetFor/
// matchesTerm operate on TableInfo only — so this only swaps out the SQL
// WHERE-building for a driver-level find(), the same split used for FK-label
// resolution (see fk-lookup.ts).
import type { ConnectionConfig, TableInfo } from "@/lib/types";
import type { MatchTarget } from "@/lib/data/search-match";
import { matchTargetFor, matchesTerm } from "@/lib/data/search-match";
import { primaryKeyColumnsFor } from "@/app/api/data/crud";
import { getMongoDb, READ_MAX_TIME_MS } from "./client";
import { serializeDoc } from "./bson";
import { coerceValue, escapeRegex } from "./filters";

type MongoFilter = Record<string, unknown>;

// The one place that turns a MatchTarget (indexed columns only — see
// matchTargetFor) into a Mongo query. Shared by global search
// (searchOneMongoCollection below) and the per-table search box
// (buildMongoSearchFilter, called from data.ts's whereFor) so both stay
// scoped to indexed columns and index-usable query shapes, matching the SQL
// path's searchClauseFor/buildMatchClause.
//
// "exact" is a typed equality (coerceValue handles the ObjectId/number/bool
// coercion an id column needs). "wordstart" mirrors buildMatchClause's two
// OR'd SQL predicates (startsField, startsWord) as two *separate* anchored
// regexes rather than one `(^|\s)term` alternation: MongoDB only recognizes a
// regex as an index-usable "prefix expression" when the pattern *itself*
// starts with a literal `^` — folding both branches into one alternation
// loses that recognition entirely, forcing an unbounded scan even for a
// plain prefix match.
export function buildMongoMatchFilter(table: TableInfo, target: MatchTarget, term: string): MongoFilter | null {
  if (target.columns.length === 0) return null;
  const escaped = escapeRegex(term);
  const ors = target.columns.map(({ col, mode }) => {
    if (mode === "exact") {
      return { [col.name]: coerceValue(table, col.name, term) };
    }
    return {
      $or: [
        { [col.name]: { $regex: `^${escaped}`, $options: "i" } },
        { [col.name]: { $regex: `\\s${escaped}`, $options: "i" } },
      ],
    };
  });
  return ors.length === 1 ? ors[0] : { $or: ors };
}

// Per-table search box's Mongo counterpart to searchClauseFor (SQL). Resolves
// its own indexed-column target from the term/pk shape, same as global search.
export function buildMongoSearchFilter(conn: ConnectionConfig, table: TableInfo, term: string): MongoFilter | null {
  const t = term.trim();
  if (!t) return null;
  const target = matchTargetFor(table, t, primaryKeyColumnsFor(conn, table));
  return buildMongoMatchFilter(table, target, t);
}

export interface MongoSearchHit {
  matchedColumn: string;
  value: string;
  pk: Record<string, unknown>;
}

export async function searchOneMongoCollection(
  conn: ConnectionConfig,
  table: TableInfo,
  key: string[],
  target: MatchTarget,
  term: string,
  limit: number,
): Promise<MongoSearchHit[]> {
  const filter = buildMongoMatchFilter(table, target, term);
  if (!filter) return [];

  const projection: Record<string, 1> = {};
  for (const k of key) projection[k] = 1;
  for (const { col } of target.columns) projection[col.name] = 1;

  const db = await getMongoDb(conn, "read");
  const coll = db.collection(table.name);
  const docs = await coll.find(filter, { projection, maxTimeMS: READ_MAX_TIME_MS }).limit(limit).toArray();

  return docs.map((doc) => {
    const row = serializeDoc(doc);
    const pk: Record<string, unknown> = {};
    for (const k of key) pk[k] = row[k];
    // Which candidate column actually satisfied the filter — same
    // not-first-non-null rule as the relational path (see searchOneTable).
    const matchedColumn =
      target.columns.find(({ col, mode }) => matchesTerm(String(row[col.name] ?? ""), term, mode))?.col.name ??
      target.columns[0].col.name;
    return { matchedColumn, value: String(row[matchedColumn] ?? ""), pk };
  });
}
