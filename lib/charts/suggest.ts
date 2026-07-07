// Chart-type suggestion engine: inspect a query result's columns (types,
// cardinality) and rank sensible chart forms (one-click "Visualize").
import type { ChartType, QueryResult } from "@/lib/types";

export type ColumnRole = "temporal" | "numeric" | "categorical" | "other";

export interface Suggestion {
  chartType: ChartType;
  xField: string | null;
  yFields: string[];
  seriesField: string | null;
  reason: string;
}

const TEMPORAL_TYPES = /date|time/i;
const NUMERIC_TYPES = /int|numeric|double|real|float|decimal|bigint|hugeint|smallint/i;

export function classifyColumns(result: QueryResult): Record<string, ColumnRole> {
  const roles: Record<string, ColumnRole> = {};
  const sample = result.rows.slice(0, 200);
  for (const col of result.columns) {
    if (TEMPORAL_TYPES.test(col.type)) {
      roles[col.name] = "temporal";
      continue;
    }
    if (NUMERIC_TYPES.test(col.type)) {
      roles[col.name] = "numeric";
      continue;
    }
    const values = sample.map((r) => r[col.name]).filter((v) => v != null);
    if (values.length === 0) {
      roles[col.name] = "other";
      continue;
    }
    // values may arrive as strings (bigint/numeric serialization) — sniff them
    if (values.every((v) => typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v))))) {
      roles[col.name] = "numeric";
      continue;
    }
    if (
      values.every((v) => typeof v === "string" && (/^\d{4}-\d{2}-\d{2}/.test(v) || !isNaN(Date.parse(v)))) &&
      values.some((v) => /^\d{4}-\d{2}-\d{2}/.test(String(v)))
    ) {
      roles[col.name] = "temporal";
      continue;
    }
    const distinct = new Set(values.map(String)).size;
    roles[col.name] = distinct <= Math.max(20, values.length * 0.5) ? "categorical" : "other";
  }
  return roles;
}

export function suggestCharts(result: QueryResult): Suggestion[] {
  const roles = classifyColumns(result);
  const names = result.columns.map((c) => c.name);
  const temporal = names.filter((n) => roles[n] === "temporal");
  const numeric = names.filter((n) => roles[n] === "numeric");
  const categorical = names.filter((n) => roles[n] === "categorical");
  const out: Suggestion[] = [];

  if (result.rows.length === 1 && numeric.length === 1) {
    out.push({ chartType: "stat", xField: null, yFields: [numeric[0]], seriesField: null, reason: "single value" });
  }
  if (temporal.length > 0 && numeric.length > 0) {
    out.push({
      chartType: "line",
      xField: temporal[0],
      yFields: numeric.slice(0, 4),
      seriesField: categorical[0] && numeric.length === 1 ? categorical[0] : null,
      reason: "time + numeric → time series",
    });
    out.push({
      chartType: "area",
      xField: temporal[0],
      yFields: numeric.slice(0, 2),
      seriesField: null,
      reason: "time series (filled)",
    });
  }
  if (categorical.length > 0 && numeric.length > 0) {
    out.push({
      chartType: "bar",
      xField: categorical[0],
      yFields: numeric.slice(0, 3),
      seriesField: null,
      reason: "categorical + numeric → comparison",
    });
    const distinct = new Set(result.rows.map((r) => String(r[categorical[0]]))).size;
    if (distinct <= 8 && numeric.length >= 1) {
      out.push({
        chartType: "pie",
        xField: categorical[0],
        yFields: [numeric[0]],
        seriesField: null,
        reason: "few categories → share of whole",
      });
    }
  }
  out.push({
    chartType: "table",
    xField: null,
    yFields: [],
    seriesField: null,
    reason: "fallback",
  });
  return out;
}
