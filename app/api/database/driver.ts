// The engine seam (Phase 9). Everything above this interface — introspection
// callers, CRUD, filters, the guard, AI serialization — stays engine-agnostic
// and talks to a `Driver`. Each supported engine (postgres, mysql, mongo)
// provides one. Relational engines additionally expose a `Dialect`: the
// synchronous SQL-text primitives that differ between them (quoting, params,
// casts, operators, error mapping). Mongo has no SQL, so its Driver carries a
// null dialect and supplies its own query builder.
//
// This file defines the contract only. Implementations live under
// `dialect/` (relational SQL primitives) and `drivers/` (per-engine wiring);
// `registry.ts` resolves an engine to its Driver.
import type { ConnectionCatalog, ConnectionConfig, DbEngine } from "@/lib/types";

// A friendly, HTTP-shaped error produced from a raw driver error. `null` means
// "not a recognized constraint/permission error — fall back to a generic 400".
export interface MappedError {
  status: number;
  message: string;
}

// The synchronous SQL-text primitives that differ between relational engines.
// Nothing here does I/O; it only produces SQL fragments and classifies errors,
// so a Dialect is pure and unit-testable without a database.
export interface Dialect {
  readonly engine: DbEngine;

  // Quote an identifier (table/column/schema). PG/ANSI: "x"; MySQL: `x`.
  quoteIdent(name: string): string;

  // A bound-parameter marker for the 1-based position `i`.
  // PG: `$i`; MySQL: `?` (position ignored).
  placeholder(i: number): string;

  // Cast an expression to text/char for uniform string comparison.
  // PG: `expr::text`; MySQL: `CAST(expr AS CHAR)`.
  castToText(expr: string): string;

  // Cast an expression to an (already sanitized) type name.
  // PG: `expr::type`; MySQL: `CAST(expr AS type)`.
  cast(expr: string, type: string): string;

  // A case-insensitive LIKE predicate: `expr` matched against the bound
  // `placeholder`. PG: `expr::text ILIKE ph`; MySQL: `LOWER(expr) LIKE LOWER(ph)`.
  caseInsensitiveLike(expr: string, placeholder: string): string;

  // A case-insensitive regex predicate. PG: `expr::text ~* ph`; MySQL: `expr REGEXP ph`.
  regexMatch(expr: string, placeholder: string): string;

  // Truncate a date/timestamp expression down to the day, for grouping rows
  // by calendar day. PG: `date_trunc('day', expr)`; MySQL: `DATE(expr)`.
  dateTrunc(expr: string): string;

  // Character used to escape LIKE metacharacters in user input.
  readonly likeEscapeChar: string;

  // Capability flags consumed by feature code to skip unsupported operations.
  readonly supportsReturning: boolean; // INSERT/UPDATE ... RETURNING
  readonly supportsArrays: boolean; // array columns + @>/&& operators
  readonly supportsSchemas: boolean; // a real schema namespace (PG yes, MySQL no)

  // Statement(s) to open a read-only transaction as belt-and-suspenders on top
  // of the read-only role. Empty when the engine has no such statement.
  beginReadOnly(): string[];

  // Classify a raw driver error (unique/FK/not-null/permission/…) into a
  // friendly message, or null if unrecognized.
  mapError(e: unknown): MappedError | null;
}

// A Driver owns the *asynchronous*, engine-specific I/O: connecting,
// introspecting into Lizard's normalized catalog, and (later phases) executing
// list/read/CRUD. Relational drivers delegate their SQL-text shaping to
// `dialect`; Mongo's is null.
export interface Driver {
  readonly engine: DbEngine;
  readonly dialect: Dialect | null;

  // Build Lizard's normalized catalog for one connection. Engines without a
  // schema namespace report a single synthetic schema (see `defaultSchema`).
  introspect(conn: ConnectionConfig): Promise<ConnectionCatalog>;

  // The schema name to assume when the browse URL omits `?schema=`. Postgres:
  // "public"; MySQL: the connection's database name; Mongo: "default".
  defaultSchema(conn: ConnectionConfig): string;
}

// Thrown by the registry for engines whose Driver/Dialect isn't built yet, so
// callers surface a clear "not supported in this phase" message rather than a
// cryptic undefined access.
export class EngineNotSupportedError extends Error {
  readonly status = 501;
  constructor(engine: DbEngine, what = "engine") {
    super(`${what} "${engine}" is not supported yet`);
    this.name = "EngineNotSupportedError";
  }
}
