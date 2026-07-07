// SQL Guard — every AI/chart/federated query passes through here. The guard is
// the security boundary (not the prompt): parse where possible, enforce
// single read-only SELECT, denylist dangerous constructs, and cap rows via a
// wrapping LIMIT. Execution adds the real teeth on top: read-only DB roles,
// READ ONLY transactions, statement timeouts, and READ_ONLY DuckDB attaches.
import { parse } from "pgsql-ast-parser";
import type { SqlDialect } from "@/lib/types";

export const MAX_ROWS = 1000;

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export interface GuardedSql {
  cleanSql: string; // validated, single statement, no trailing semicolon
  wrappedSql: string; // cleanSql wrapped in an outer LIMIT
  parsed: boolean; // whether AST validation succeeded (vs lexical-only)
}

// Dangerous even inside a SELECT on Postgres.
const PG_DENYLIST = [
  "pg_sleep",
  "pg_sleep_for",
  "pg_sleep_until",
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_stat_file",
  "pg_logdir_ls",
  "pg_terminate_backend",
  "pg_cancel_backend",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "pg_promote",
  "pg_switch_wal",
  "pg_create_restore_point",
  "pg_advisory_lock",
  "pg_advisory_xact_lock",
  "dblink",
  "dblink_exec",
  "dblink_connect",
  "lo_import",
  "lo_export",
  "lo_unlink",
  "nextval",
  "setval",
  "lastval",
  "set_config",
  "pg_notify",
  "txid_current", // harmless but pointless; keep AI honest
];

// Statement-level keywords that must never appear (checked with word
// boundaries after string literals are removed).
const WRITE_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "merge",
  "truncate",
  "drop",
  "alter",
  "create",
  "grant",
  "revoke",
  "vacuum",
  "analyze",
  "reindex",
  "cluster",
  "comment",
  "copy",
  "call",
  "do",
  "listen",
  "notify",
  "unlisten",
  "prepare",
  "execute",
  "deallocate",
  "declare",
  "fetch",
  "lock",
  "checkpoint",
  "reset",
  "discard",
  "security",
  "into", // SELECT INTO creates a table
];

// DuckDB-specific: Lizard controls attachments; the model must never manage
// them or touch the filesystem / extensions.
const DUCKDB_DENYLIST = [
  "attach",
  "detach",
  "install",
  "load",
  "pragma",
  "export",
  "import",
  "force",
  "read_csv",
  "read_csv_auto",
  "read_parquet",
  "read_json",
  "read_json_auto",
  "read_json_objects",
  "read_text",
  "read_blob",
  "read_ndjson",
  "read_ndjson_auto",
  "parquet_scan",
  "glob",
  "getenv",
  "sniff_csv",
  "copy",
  "postgres_execute",
  "postgres_query",
  "postgres_scan",
  "duckdb_settings",
  "enable_external_access",
];

// Strip string literals (single-quoted, dollar-quoted) so keyword scans can't
// be fooled by words inside strings, then reject any comment syntax outright.
function stripStrings(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // single-quoted string, '' escapes a quote
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          break;
        } else i++;
      }
      out += " '' ";
      continue;
    }
    if (ch === "$") {
      const m = sql.slice(i).match(/^\$([A-Za-z_]*)\$/);
      if (m) {
        const closer = m[0];
        const end = sql.indexOf(closer, i + closer.length);
        if (end === -1) throw new GuardError("Unterminated dollar-quoted string");
        out += " '' ";
        i = end + closer.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function lexicalChecks(sql: string, dialect: SqlDialect): string {
  const trimmed = sql
    .trim()
    .replace(/;+\s*$/g, "")
    .trim();
  if (!trimmed) throw new GuardError("Empty SQL");

  const noStrings = stripStrings(trimmed);

  if (noStrings.includes("--") || noStrings.includes("/*") || noStrings.includes("*/")) {
    throw new GuardError("Comments are not allowed in queries");
  }
  if (noStrings.includes(";")) {
    throw new GuardError("Multiple statements are not allowed");
  }
  if (/\\\s*[!.]/.test(noStrings)) {
    throw new GuardError("Meta-commands are not allowed");
  }
  if (!/^\s*(select|with)\b/i.test(trimmed)) {
    throw new GuardError("Only SELECT queries are allowed");
  }

  const lower = noStrings.toLowerCase();
  const hasWord = (w: string) => new RegExp(`(^|[^a-z0-9_."])${w}([^a-z0-9_.]|$)`).test(lower);

  for (const kw of WRITE_KEYWORDS) {
    if (hasWord(kw)) throw new GuardError(`Forbidden keyword in query: ${kw.toUpperCase()}`);
  }
  for (const fn of PG_DENYLIST) {
    if (hasWord(fn)) throw new GuardError(`Forbidden function in query: ${fn}`);
  }
  if (/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(lower)) {
    throw new GuardError("Row locking (FOR UPDATE/SHARE) is not allowed");
  }
  if (dialect === "duckdb") {
    for (const kw of DUCKDB_DENYLIST) {
      if (hasWord(kw)) throw new GuardError(`Forbidden on the federation path: ${kw}`);
    }
    // any function that reads files by name, e.g. read_something('...')
    if (/\bread_[a-z_]*\s*\(/.test(lower)) {
      throw new GuardError("File-reading functions are not allowed");
    }
  }
  return trimmed;
}

// AST validation (Postgres dialect): must parse to exactly one SELECT-ish
// statement. WITH is fine as long as every branch is a select.
function astChecks(sql: string): boolean {
  let statements;
  try {
    statements = parse(sql);
  } catch {
    return false; // fall back to lexical-only (execution is still read-only)
  }
  if (statements.length !== 1) {
    throw new GuardError("Multiple statements are not allowed");
  }
  const st = statements[0] as { type: string };
  const okTypes = new Set(["select", "with", "union", "union all", "values", "with recursive"]);
  if (!okTypes.has(st.type)) {
    throw new GuardError(`Only SELECT queries are allowed (got ${st.type.toUpperCase()})`);
  }
  // WITH: every CTE statement and the final statement must be selects
  if (st.type === "with" || st.type === "with recursive") {
    const w = st as unknown as { bind: { statement: { type: string } }[]; in: { type: string } };
    for (const b of w.bind ?? []) {
      if (!okTypes.has(b.statement.type)) {
        throw new GuardError("CTEs may only contain SELECT statements");
      }
    }
    if (!okTypes.has(w.in.type)) {
      throw new GuardError("Only SELECT queries are allowed");
    }
  }
  return true;
}

export function guardSql(sql: string, dialect: SqlDialect): GuardedSql {
  const cleanSql = lexicalChecks(sql, dialect);
  let parsed = false;
  if (dialect === "postgres") {
    parsed = astChecks(cleanSql);
  }
  // Hard row cap: wrap the whole query. Inner ORDER BY / LIMIT are preserved.
  const wrappedSql = `SELECT * FROM (\n${cleanSql}\n) AS _lizard_q LIMIT ${MAX_ROWS + 1}`;
  return { cleanSql, wrappedSql, parsed };
}
