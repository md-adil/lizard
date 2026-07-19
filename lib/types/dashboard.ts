import type { QueryTarget, SqlDialect } from "./query";

// Single source of truth for the chart-type list — spec-controls.tsx's type
// picker, the panels API's zod enum, and ChartType itself all derive from
// this instead of repeating the list independently. chart-renderer.tsx's
// per-type ECharts option-building deliberately does NOT derive from this:
// each type's option shape differs too much (pie's single x/y extraction,
// stat/table needing no ECharts option at all) for a shared descriptor to
// remove any of those branches.
export const CHART_TYPES = {
  line: { label: "Line", needsXField: true, singleValueField: false },
  area: { label: "Area", needsXField: true, singleValueField: false },
  "area-stacked": { label: "Area (stacked)", needsXField: true, singleValueField: false },
  bar: { label: "Bar", needsXField: true, singleValueField: false },
  "bar-stacked": { label: "Bar (stacked)", needsXField: true, singleValueField: false },
  "bar-horizontal": { label: "Bar (horizontal)", needsXField: true, singleValueField: false },
  scatter: { label: "Scatter", needsXField: true, singleValueField: false },
  pie: { label: "Pie", needsXField: true, singleValueField: true },
  donut: { label: "Donut", needsXField: true, singleValueField: true },
  heatmap: { label: "Heatmap", needsXField: true, singleValueField: true },
  gauge: { label: "Gauge", needsXField: false, singleValueField: true },
  stat: { label: "Stat", needsXField: false, singleValueField: true },
  table: { label: "Table", needsXField: false, singleValueField: false },
} as const satisfies Record<string, { label: string; needsXField: boolean; singleValueField: boolean }>;

export type ChartType = keyof typeof CHART_TYPES;

// Row/point click on this panel navigates to the target table's record page
// (component/browse's recordHref) instead of doing nothing. keyField is the
// query result column holding the id value; keyColumn is the target table's
// column to match it against (usually its effective primary key).
export interface ChartLinkTarget {
  connection: string;
  schema?: string | null;
  table: string;
  keyField: string;
  keyColumn: string;
}

// Stat/gauge value coloring. highIsBad flips which threshold direction reads
// as "bad" (e.g. error rate vs. uptime %).
export interface ChartThresholds {
  warn: number | null;
  crit: number | null;
  highIsBad: boolean;
}

export interface ChartSpec {
  title: string;
  chartType: ChartType;
  target: QueryTarget;
  connections: string[];
  sql: string;
  dialect: SqlDialect;
  xField: string | null;
  yFields: string[];
  seriesField: string | null; // categorical column that splits into series
  linkTo: ChartLinkTarget | null;
  thresholds: ChartThresholds | null;
  // Server-side query-result cache TTL in seconds — null/0 means always
  // re-execute (today's behavior). Distinct from the dashboard's
  // refreshSeconds, which only controls how often the browser re-asks.
  cacheSeconds: number | null;
}

export interface Panel {
  id: string;
  dashboardId: string;
  spec: ChartSpec;
  // Real grid coordinates in a 12-column react-grid-layout: x/y is the cell
  // position, w/h the span (rowHeight 40px). Persisted in bulk after each
  // drag/resize via updatePanelLayout (lib/metadata/store.ts).
  x: number;
  y: number;
  w: number;
  h: number;
}

// A dropdown option's displayed label can differ from the value actually
// substituted into SQL (e.g. label "Pending orders", value "pending").
export interface VariableOption {
  label: string;
  value: string;
}

// A "select" variable's option list either comes from a hand-typed list
// (static) or is fetched live via /api/query (query) — e.g. "every distinct
// status in the orders table" instead of an enum that goes stale. valueField
// is the output column substituted into SQL; labelField (defaults to
// valueField when null) is only for display, e.g. an id/name pair.
export type SelectSource =
  | { kind: "static"; options: VariableOption[] }
  | {
      kind: "query";
      target: QueryTarget;
      connections: string[];
      sql: string;
      dialect: SqlDialect;
      valueField: string | null;
      labelField: string | null;
    };

// Dashboard-wide filter, substituted into panel SQL via {{name}} (or
// {{name.from}}/{{name.to}} for a date range) before the panel's query runs.
// A small, deliberately curated set of prebuilt kinds — each fully realized —
// rather than a wide menu of thin variable stubs. name is the token used in
// SQL ({{name}}) — must stay identifier-shaped (\w+) since it's matched by
// that regex in substituteVariables. label is purely the human-readable text
// shown in the toolbar/settings list, so a variable can be named `status`
// but labeled "Order status".
export type DashboardVariable =
  | { name: string; label: string; type: "text"; value: string }
  | { name: string; label: string; type: "select"; source: SelectSource; value: string }
  // from/to are "yyyy-MM-dd" when includeTime is false, "yyyy-MM-dd HH:mm"
  // when true — same fields, same {{name.from}}/{{name.to}} tokens either way.
  | { name: string; label: string; type: "daterange"; from: string; to: string; includeTime: boolean };

export interface Dashboard {
  id: string;
  name: string;
  refreshSeconds: number | null;
  createdAt: string;
  panels: Panel[];
  variables: DashboardVariable[];
  // Per-requesting-user pin state (dashboard_pins table) — stamped onto API
  // responses by the dashboards routes, absent in raw store reads.
  pinned?: boolean;
}
