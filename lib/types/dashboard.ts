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
  bar: { label: "Bar", needsXField: true, singleValueField: false },
  pie: { label: "Pie", needsXField: true, singleValueField: true },
  stat: { label: "Stat", needsXField: false, singleValueField: true },
  table: { label: "Table", needsXField: false, singleValueField: false },
} as const satisfies Record<string, { label: string; needsXField: boolean; singleValueField: boolean }>;

export type ChartType = keyof typeof CHART_TYPES;

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

export interface Dashboard {
  id: string;
  name: string;
  refreshSeconds: number | null;
  createdAt: string;
  panels: Panel[];
}
