import type { DashboardVariable } from "@/lib/types";

// A date range is a single dashboard-wide concept (Grafana's built-in time
// picker) — unlike text/select, it's not a user-managed variable at all.
// It's not stored in Dashboard.variables and never appears in Settings >
// Variables; it's just always present in the header, on every dashboard,
// starting from this fixed default each time the page loads.
export const DATETIME_VARIABLE_NAME = "datetime";
export const DATETIME_VARIABLE_LABEL = "Date range";

export function defaultDatetimeVariable(): Extract<DashboardVariable, { type: "daterange" }> {
  return { name: DATETIME_VARIABLE_NAME, label: DATETIME_VARIABLE_LABEL, type: "daterange", from: "", to: "", includeTime: true };
}

// The datetime range gets its own plain ?from=&to= params — no ~ prefix and
// no ties to the ~<name> variable scheme below, since it isn't a variable.
export function applySearchParamsToDatetime(
  dt: Extract<DashboardVariable, { type: "daterange" }>,
  params: URLSearchParams,
): Extract<DashboardVariable, { type: "daterange" }> {
  const from = params.get("from");
  const to = params.get("to");
  return from === null && to === null ? dt : { ...dt, from: from ?? dt.from, to: to ?? dt.to };
}

export function withDatetimeInSearchParams(
  base: URLSearchParams,
  dt: Extract<DashboardVariable, { type: "daterange" }>,
): URLSearchParams {
  const params = new URLSearchParams(base);
  if (dt.from) params.set("from", dt.from);
  else params.delete("from");
  if (dt.to) params.set("to", dt.to);
  else params.delete("to");
  return params;
}

// Substitutes ${name} in panel SQL with the variable's current value (${name.from}/${name.to}
// for a date range) — Grafana's own templating syntax, so panel SQL reads the same way a
// Grafana user would already expect. Unknown tokens are left untouched rather than blanked, so
// a typo in the SQL surfaces as a SQL error instead of a silently empty predicate.
export function substituteVariables(sql: string, variables: DashboardVariable[]): string {
  return sql.replace(/\$\{(\w+)(?:\.(from|to))?\}/g, (match, name: string, part: "from" | "to" | undefined) => {
    const v = variables.find((x) => x.name === name);
    if (!v) return match;
    if (v.type === "daterange") return part === "to" ? v.to : v.from;
    return v.value;
  });
}

// User-managed variables (text/select — never daterange, see above) live in
// the URL under Grafana's own `var-<name>` prefix, distinct from the datetime
// range's plain from/to params — current filter state is bookmarkable/
// shareable/back-button-navigable rather than living only in React state
// that resets on refresh. Matching Grafana's convention (rather than
// something bespoke) means a query string built for one is legible/portable
// to someone used to the other.
const VAR_PREFIX = "var-";

// Overlays URL param values onto the dashboard's saved variable defaults —
// called once per dashboard load so a shared/bookmarked link reproduces the
// same filter state, not just the defaults.
export function applySearchParamsToVariables(
  variables: DashboardVariable[],
  params: URLSearchParams,
): DashboardVariable[] {
  return variables.map((v) => {
    if (v.type === "daterange") return v;
    const value = params.get(`${VAR_PREFIX}${v.name}`);
    return value === null ? v : { ...v, value };
  });
}

// Rewrites every var-* entry in `base` to match `variables`' current
// values, leaving unrelated params (e.g. ?edit=1, ?from=/?to=) untouched.
export function withVariablesInSearchParams(base: URLSearchParams, variables: DashboardVariable[]): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of [...params.keys()]) {
    if (key.startsWith(VAR_PREFIX)) params.delete(key);
  }
  for (const v of variables) {
    if (v.type !== "daterange" && v.value) params.set(`${VAR_PREFIX}${v.name}`, v.value);
  }
  return params;
}
