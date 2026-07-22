// Postgres SQL-text primitives. This is the single source of truth for the
// fragments currently inlined across app/api/data/crud.ts and lib/data/filters.ts;
// Phase 9A migrates those consumers onto it. Behavior here mirrors today's code
// exactly — extracting it, not changing it.
import type { Dialect, MappedError } from "@/app/api/database/driver";

export const postgresDialect: Dialect = {
  engine: "postgres",

  quoteIdent(name) {
    return `"${name.replace(/"/g, '""')}"`;
  },

  placeholder(i) {
    return `$${i}`;
  },

  castToText(expr) {
    return `${expr}::text`;
  },

  cast(expr, type, typeSchema) {
    const qualifiedType = typeSchema ? `${this.quoteIdent(typeSchema)}.${type}` : type;
    return `${expr}::${qualifiedType}`;
  },

  caseInsensitiveLike(expr, placeholder) {
    return `${expr}::text ILIKE ${placeholder}`;
  },

  regexMatch(expr, placeholder) {
    return `${expr}::text ~* ${placeholder}`;
  },

  dateTrunc(expr) {
    return `date_trunc('day', ${expr})`;
  },

  likeEscapeChar: "\\",

  supportsReturning: true,
  supportsArrays: true,
  supportsSchemas: true,

  beginReadOnly() {
    return ["BEGIN TRANSACTION READ ONLY"];
  },

  // Ported verbatim from crud.ts:friendlyDbError (SQLSTATE codes).
  mapError(e): MappedError | null {
    const err = e as {
      code?: string;
      detail?: string;
      message?: string;
      column?: string;
      constraint?: string;
    };
    switch (err.code) {
      case "23505":
        return {
          status: 409,
          message: `Duplicate value violates unique constraint${err.detail ? `: ${err.detail}` : ""}`,
        };
      case "23503":
        return { status: 409, message: `Referenced row does not exist${err.detail ? `: ${err.detail}` : ""}` };
      case "23502":
        return { status: 400, message: `"${err.column}" is required and cannot be empty` };
      case "23514":
        return { status: 400, message: `Value violates check constraint "${err.constraint}"` };
      case "22P02":
        return { status: 400, message: `Invalid value format: ${err.message}` };
      case "42501":
        return { status: 403, message: "The write role lacks permission for this operation" };
      case "42704":
        return {
          status: 400,
          message: `Referenced type or object does not exist${err.message ? `: ${err.message}` : ""}`,
        };
      default:
        return null;
    }
  },
};
