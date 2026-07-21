export type QueryTarget = "single" | "federated";
export type SqlDialect = "postgres" | "mysql" | "duckdb";

export interface QueryRequest {
  target: QueryTarget;
  connections: string[]; // connection names
  sql: string;
  dialect: SqlDialect;
  // If set, runGuardedQuery may serve a recent result from lib/query-cache
  // instead of re-executing (server-side TTL, seconds).
  cacheSeconds?: number;
}

export interface QueryResultColumn {
  name: string;
  type: string; // best-effort type name
}

export interface QueryResult {
  columns: QueryResultColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  connections: string[]; // which connections were touched
  sql: string; // the SQL actually executed (pre-wrap)
}

export interface SavedQuery {
  id: string;
  name: string;
  nlPrompt: string | null;
  target: QueryTarget;
  connections: string[];
  sql: string;
  dialect: SqlDialect;
  createdAt: string;
}
