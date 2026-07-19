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
