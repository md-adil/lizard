import type { QueryTarget, SqlDialect } from "./query";

export type ChartType = "line" | "bar" | "pie" | "stat" | "table" | "area";

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
  // grid position: 12-column layout
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
