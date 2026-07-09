// Structured logging (pino). Server-only — never import from a client
// component. Configuration is entirely env-driven so query tracing can be
// switched on in a running deployment without a code change:
//
//   LIZARD_LOG_LEVEL       fatal|error|warn|info|debug|trace   (default: info)
//   LIZARD_LOG_QUERIES     true → log every SQL statement it executes
//   LIZARD_LOG_QUERY_PARAMS true → include bound parameter values
//   LIZARD_SLOW_QUERY_MS   warn on any query slower than this (default: 500)
//   LIZARD_LOG_PRETTY      true → human-readable output instead of JSON lines
//
// Bound parameters are withheld by default: they are row values, which for
// this app means customer data. Turning LIZARD_LOG_QUERY_PARAMS on writes them
// to your logs — do that deliberately, in development.
import pino from "pino";

function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

const pretty = envFlag("LIZARD_LOG_PRETTY", process.env.NODE_ENV !== "production");

export const logger = pino({
  level: process.env.LIZARD_LOG_LEVEL ?? "info",
  base: undefined, // drop pid/hostname noise
  ...(pretty
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export const logQueries = envFlag("LIZARD_LOG_QUERIES");
export const logQueryParams = envFlag("LIZARD_LOG_QUERY_PARAMS");
export const slowQueryMs = Number(process.env.LIZARD_SLOW_QUERY_MS ?? 500);

const dbLog = logger.child({ component: "db" });

// Collapse whitespace so a multi-line template literal reads as one log line.
function oneLine(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

export interface QueryLogContext {
  connection: string;
  engine: string;
  role: string;
}

/**
 * Record one executed statement. Always emits when it was slow (that is the
 * signal you actually want in production) or when it failed; otherwise only
 * under LIZARD_LOG_QUERIES.
 */
export function logQuery(
  ctx: QueryLogContext,
  sql: string,
  params: unknown[] | undefined,
  durationMs: number,
  result: { rowCount?: number } | { error: unknown },
): void {
  const failed = "error" in result;
  const slow = durationMs >= slowQueryMs;
  if (!failed && !slow && !logQueries) return;

  const fields: Record<string, unknown> = {
    ...ctx,
    sql: oneLine(sql),
    durationMs: Math.round(durationMs),
  };
  if (logQueryParams && params?.length) fields.params = params;
  if (!failed) fields.rowCount = (result as { rowCount?: number }).rowCount;

  if (failed) {
    const e = (result as { error: unknown }).error;
    dbLog.error({ ...fields, err: e instanceof Error ? e.message : String(e) }, "query failed");
  } else if (slow) {
    // A slow query is usually a non-sargable predicate — a cast or function
    // wrapped around an indexed column stops the planner using its index.
    dbLog.warn({ ...fields, slowQueryMs }, "slow query");
  } else {
    dbLog.debug(fields, "query");
  }
}
