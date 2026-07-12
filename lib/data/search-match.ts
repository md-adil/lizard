// Shared column-selection + WHERE-clause logic for both cross-table global
// search (lib/data/global-search.ts) and the per-table search box
// (lib/data/crud.ts's listRows/exportRows) — same rule either way: only
// *indexed* columns are ever searched (an unindexed column means a full
// scan regardless of table size, which is exactly what indexed-only
// scoping is meant to avoid), narrowed further by what the term looks like.
import type { ColumnInfo, TableInfo } from "@/lib/types";
import { NUMERIC_UDTS } from "@/lib/introspect/heuristics";
import type { Dialect } from "@/app/api/database/driver";
import { escapeLike } from "@/lib/data/filters";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^\d+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MatchMode = "exact" | "wordstart";

export interface MatchColumn {
  col: ColumnInfo;
  mode: MatchMode;
}

export interface MatchTarget {
  columns: MatchColumn[];
}

// Which columns of `table` are worth searching for a term of this shape, and
// how each is compared. Two independent things decide the mode:
//  - a UUID/int-shaped term almost certainly names one specific row by its
//    id — an equality lookup is both more correct (no accidental prefix
//    collision, e.g. "123" matching "1234") and cheaper (a plain index seek,
//    not even a range scan) than a LIKE. Everything else defaults to a
//    word-start LIKE (see buildMatchClause).
//  - a primary key column — real, or the "pretend"/custom PK override
//    (`pkColumnNames`) — is *always* compared exactly, regardless of the
//    term's shape or the key's own type: an id is a whole-value identifier,
//    never a "starts with" target, whether it's numeric, a uuid, or a
//    text-based custom key like an order number.
// Empty columns means "skip this table/search" — no query is issued for it.
export function matchTargetFor(table: TableInfo, term: string, pkColumnNames: string[]): MatchTarget {
  const indexed = new Set(table.indexedColumns);
  const pk = new Set(pkColumnNames);

  let shapeColumns: ColumnInfo[];
  let defaultMode: MatchMode;
  if (UUID_RE.test(term)) {
    shapeColumns = table.columns.filter((c) => c.udtName === "uuid" && indexed.has(c.name));
    defaultMode = "exact";
  } else if (INT_RE.test(term)) {
    shapeColumns = table.columns.filter((c) => indexed.has(c.name) && NUMERIC_UDTS.has(c.udtName));
    defaultMode = "exact";
  } else {
    const emailColumns = table.columns.filter((c) => /email/i.test(c.name) && indexed.has(c.name));
    if (EMAIL_RE.test(term) && emailColumns.length > 0) {
      shapeColumns = emailColumns;
    } else {
      shapeColumns = table.columns.filter((c) => indexed.has(c.name));
    }
    defaultMode = "wordstart";
  }

  const columns = shapeColumns.map((c) => ({ col: c, mode: pk.has(c.name) ? ("exact" as const) : defaultMode }));
  return { columns };
}

// `term` is the raw, unescaped user input — escaping for the word-start LIKE
// branch happens here, once, via the same escapeLike (lib/data/filters.ts)
// the filter-builder's contains/startswith/endswith operators already use.
// That's a real requirement, not just tidiness: a term containing a literal
// backslash (e.g. Laravel's "App\Models\User") is itself a LIKE escape
// sequence starter, so leaving it unescaped produces a malformed pattern the
// engine rejects — escapeLike escapes the escape character itself along
// with `%`/`_`, unlike a naive `%`/`_`-only replace.
export function buildMatchClause(target: MatchTarget, term: string, values: unknown[], dialect: Dialect): string {
  const push = (v: unknown) => {
    values.push(v);
    return dialect.placeholder(values.length);
  };
  const escaped = escapeLike(term, dialect.likeEscapeChar);
  const parts = target.columns.map(({ col, mode }) => {
    if (mode === "exact") {
      // Cast the *parameter* to the column's type, not the column — casting
      // the column (`col::text = $1`) isn't sargable, so the planner can't
      // use an index on it. Casting a bound constant is free; the planner
      // folds it, and the comparison can still seek the index directly.
      return `${dialect.quoteIdent(col.name)} = ${dialect.cast(dialect.castToText(push(term)), col.udtName)}`;
    }
    const c = dialect.quoteIdent(col.name);
    const startsField = dialect.caseInsensitiveLike(c, push(`${escaped}%`));
    const startsWord = dialect.caseInsensitiveLike(c, push(`% ${escaped}%`));
    return `(${startsField} OR ${startsWord})`;
  });
  return `(${parts.join(" OR ")})`;
}

// Same matching rule, checked in JS against an already-fetched value —
// used to attribute a hit to the column that actually caused the match
// (see lib/data/global-search.ts's searchOneTable) rather than guessing.
export function matchesTerm(value: string, term: string, mode: MatchMode): boolean {
  if (mode === "exact") return value === term;
  const v = value.toLowerCase();
  const t = term.toLowerCase();
  return v.startsWith(t) || v.includes(` ${t}`);
}
