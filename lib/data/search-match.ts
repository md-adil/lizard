// Shared column-selection + WHERE-clause logic for both cross-table global
// search (lib/data/global-search.ts) and the per-table search box
// (app/api/data/crud.ts's listRows/exportRows) — same rule either way: only
// *indexed* columns are ever searched (an unindexed column means a full
// scan regardless of table size, which is exactly what indexed-only
// scoping is meant to avoid), narrowed further by what the term looks like.
import type { ColumnInfo, TableInfo } from "@/lib/types";
import { NUMERIC_UDTS, TEXT_UDTS } from "@/lib/introspect/heuristics";
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

// column name -> Set of its enum members, for O(1) membership checks. Built
// once per table (see buildEnumSets) rather than re-derived from
// col.enumValues on every keystroke of a cross-table search.
export type EnumSets = Map<string, Set<string>>;

export function buildEnumSets(table: TableInfo): EnumSets {
  const sets: EnumSets = new Map();
  for (const c of table.columns) {
    if (c.enumValues?.length) sets.set(c.name, new Set(c.enumValues));
  }
  return sets;
}

// Whether `term`, as typed, is a value the database can actually cast into a
// column of this type — e.g. `CAST('amil' AS int4)` isn't "no match", it's a
// runtime SQL error, so an incompatible pairing must never reach "exact"
// mode (see buildMatchClause's cast-the-parameter comparison).
function isCastCompatible(udtName: string, term: string): boolean {
  if (NUMERIC_UDTS.has(udtName)) return INT_RE.test(term);
  if (udtName === "uuid") return UUID_RE.test(term);
  return true; // text-like types accept any string as a candidate value
}

// An enum column is a small fixed vocabulary, not a "starts with" target —
// the term either names one of its members exactly or it can't possibly
// match, so there's no LIKE-worthy middle ground the way there is for free
// text. Falls back to building the Set inline when the caller has no
// precomputed one (the single-table search box has no session to prepare it
// in — see app/api/data/crud.ts).
function isEnumMatch(col: ColumnInfo, term: string, enumSets?: EnumSets): boolean {
  const set = enumSets?.get(col.name) ?? (col.enumValues?.length ? new Set(col.enumValues) : undefined);
  return !!set?.has(term);
}

// Which columns of `table` are worth searching for a term of this shape, and
// how each is compared. Two independent things decide the mode:
//  - a UUID/int-shaped term almost certainly names one specific row by its
//    id — an equality lookup is both more correct (no accidental prefix
//    collision, e.g. "123" matching "1234") and cheaper (a plain index seek,
//    not even a range scan) than a LIKE. Everything else defaults to a
//    word-start LIKE (see buildMatchClause).
//  - a primary key column — real, or the "pretend"/custom PK override
//    (`pkColumnNames`) — is compared exactly whenever the term is valid for
//    its type: an id is a whole-value identifier, never a "starts with"
//    target, whether it's numeric, a uuid, or a text-based custom key like
//    an order number. A numeric/uuid PK paired with an incompatible term
//    (e.g. "amil" against an int4 id) falls back to the shape's own default
//    mode instead — columns reached via the UUID_RE/INT_RE branches below
//    are always compatible by construction, so this only ever matters for a
//    PK reached through the word-start/general branch.
// Empty columns means "skip this table/search" — no query is issued for it.
export function matchTargetFor(
  table: TableInfo,
  term: string,
  pkColumnNames: string[],
  enumSets?: EnumSets,
): MatchTarget {
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
      // A word-start LIKE only ever makes sense against a text-like column
      // (or a matching enum, handled as its own exact case below) — a
      // numeric/date/boolean/jsonb column can never contain the term as a
      // substring, so including it here would just force a wasted,
      // non-sargable ::text cast+compare per row for a column that has zero
      // chance of matching. At a schema with thousands of tables, most of
      // whose indexed columns are ids/fks/timestamps rather than free text,
      // this is what keeps a search from issuing a query against every
      // single table: a table with no text-like (or enum-matching) indexed
      // column now falls out to zero shapeColumns and is skipped entirely,
      // before ever touching a connection — see the target.columns.length
      // === 0 check at this function's call sites.
      shapeColumns = table.columns.filter(
        (c) =>
          indexed.has(c.name) &&
          (TEXT_UDTS.has(c.udtName) || !!c.enumValues?.length) &&
          (!c.enumValues?.length || isEnumMatch(c, term, enumSets)),
      );
    }
    defaultMode = "wordstart";
  }

  const columns = shapeColumns.map((c) => {
    const exact =
      defaultMode === "exact" ||
      (pk.has(c.name) && isCastCompatible(c.udtName, term)) ||
      (!!c.enumValues?.length && isEnumMatch(c, term, enumSets));
    return { col: c, mode: exact ? ("exact" as const) : ("wordstart" as const) };
  });
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
      //
      // A text column needs no cast at all: the term is already a string. On
      // MySQL the cast is actively harmful there, since its result carries the
      // connection's collation rather than the column's and the two then refuse
      // to compare ("illegal mix of collations"). Bound bare, the parameter
      // adopts the column's own collation.
      const bound = push(term);
      const rhs = TEXT_UDTS.has(col.udtName) ? bound : dialect.cast(dialect.castToText(bound), col.udtName);
      return `${dialect.quoteIdent(col.name)} = ${rhs}`;
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
