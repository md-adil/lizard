import type { DashboardVariable } from "@/lib/types";

// Substitutes {{name}} in panel SQL with the variable's current value.
// Unknown tokens are left untouched rather than blanked, so a typo in the
// SQL surfaces as a SQL error instead of a silently empty predicate.
export function substituteVariables(sql: string, variables: DashboardVariable[]): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const v = variables.find((x) => x.name === name);
    return v ? v.value : match;
  });
}
