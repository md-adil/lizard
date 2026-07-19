import type { DashboardVariable } from "@/lib/types";

// Substitutes {{name}} in panel SQL with the variable's current value ({{name.from}}/{{name.to}}
// for a date range). Unknown tokens are left untouched rather than blanked, so a typo in the
// SQL surfaces as a SQL error instead of a silently empty predicate.
export function substituteVariables(sql: string, variables: DashboardVariable[]): string {
  return sql.replace(/\{\{(\w+)(?:\.(from|to))?\}\}/g, (match, name: string, part: "from" | "to" | undefined) => {
    const v = variables.find((x) => x.name === name);
    if (!v) return match;
    if (v.type === "daterange") return part === "to" ? v.to : v.from;
    return v.value;
  });
}

// Dashboard variables live in the URL under a `~<name>` prefix — current
// filter state is bookmarkable/shareable/back-button-navigable rather than
// living only in React state that resets on refresh. `~` is an RFC 3986
// unreserved character, so it never gets percent-encoded and reads cleanly
// in the address bar. daterange gets two params (~<name>-from/-to) since it
// has no single "value".
const VAR_PREFIX = "~";

// Overlays URL param values onto the dashboard's saved variable defaults —
// called once per dashboard load so a shared/bookmarked link reproduces the
// same filter state, not just the defaults.
export function applySearchParamsToVariables(
  variables: DashboardVariable[],
  params: URLSearchParams,
): DashboardVariable[] {
  return variables.map((v) => {
    if (v.type === "daterange") {
      const from = params.get(`${VAR_PREFIX}${v.name}-from`);
      const to = params.get(`${VAR_PREFIX}${v.name}-to`);
      return from === null && to === null ? v : { ...v, from: from ?? v.from, to: to ?? v.to };
    }
    const value = params.get(`${VAR_PREFIX}${v.name}`);
    return value === null ? v : { ...v, value };
  });
}

// Rewrites every ~-prefixed entry in `base` to match `variables`' current
// values, leaving unrelated params (e.g. ?edit=1) untouched.
export function withVariablesInSearchParams(base: URLSearchParams, variables: DashboardVariable[]): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of [...params.keys()]) {
    if (key.startsWith(VAR_PREFIX)) params.delete(key);
  }
  for (const v of variables) {
    if (v.type === "daterange") {
      if (v.from) params.set(`${VAR_PREFIX}${v.name}-from`, v.from);
      if (v.to) params.set(`${VAR_PREFIX}${v.name}-to`, v.to);
    } else if (v.value) {
      params.set(`${VAR_PREFIX}${v.name}`, v.value);
    }
  }
  return params;
}
