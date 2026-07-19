import { LRUCache } from "lru-cache";
import type { QueryRequest, QueryResult } from "@/lib/types";

// In-memory, single-process TTL cache for panel query results. Bounded by
// count (not just time) via lru-cache, so a dashboard with many distinct
// cached panel queries can't grow this unboundedly — consistent with the
// rest of the app's non-distributed, single-server model (no Redis/external
// cache anywhere else in the codebase).
const cache = new LRUCache<string, QueryResult>({
  max: 500,
  ttl: 60 * 60_000, // per-entry ttl is set explicitly on each `set` call below; this is just a backstop ceiling
});

export function cacheKeyFor(req: Pick<QueryRequest, "target" | "connections" | "sql" | "dialect">): string {
  return JSON.stringify({ target: req.target, connections: req.connections, sql: req.sql, dialect: req.dialect });
}

export function getCached(key: string): QueryResult | null {
  return cache.get(key) ?? null;
}

export function setCached(key: string, result: QueryResult, ttlSeconds: number): void {
  cache.set(key, result, { ttl: ttlSeconds * 1000 });
}
