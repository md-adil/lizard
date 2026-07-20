"use client";

// Renders a ChartSpec + QueryResult with ECharts, themed to Lizard's UI.
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ChartSpec, ChartThresholds, QueryResult } from "@/lib/types";
import { ResultGrid } from "@/components/ai/result-grid";
import { recordHref } from "@/components/browse/use-schema-param";
import { useTheme, type ThemeName } from "@/components/useTheme";

// Categorical chart types where a click unambiguously names one x/category
// value — wired to cross-filter a same-named dashboard variable. Axis charts
// with a continuous or multi-series x (line/area/scatter) are excluded: a
// click there doesn't name a single filterable value as cleanly.
const CROSS_FILTER_TYPES = new Set<ChartSpec["chartType"]>(["bar", "bar-stacked", "bar-horizontal", "pie", "donut"]);

// Continuous-axis chart types where a drag-select unambiguously names a time
// window — wired to set the dashboard's datetime variable (Grafana's
// "drag the graph to zoom the time range"). Deliberately disjoint from
// CROSS_FILTER_TYPES (bar/pie use click, these use drag) so the two gestures
// never compete for the same pointer interaction on one chart.
const TIME_BRUSH_TYPES = new Set<ChartSpec["chartType"]>(["line", "area", "area-stacked", "scatter"]);

// Minimal shape of the echarts-for-react instance passed to onChartReady —
// only what the PNG-export button and the time-brush setup need, so no
// echarts type dependency here.
export interface EchartsExportHandle {
  getDataURL(opts: { pixelRatio?: number; backgroundColor?: string }): string;
  dispatchAction?(action: Record<string, unknown>): void;
}

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// Both palettes validated with the dataviz six-checks validator against their
// surface (#11151f dark, #ffffff light). Fixed assignment order, never cycled.
const CHART_THEMES: Record<
  ThemeName,
  {
    palette: string[];
    textDim: string;
    gridLine: string;
    tooltipBg: string;
    tooltipBorder: string;
    tooltipText: string;
    surface: string;
  }
> = {
  dark: {
    palette: ["#3987e5", "#199e70", "#c98500", "#9085e9", "#e66767", "#d55181"],
    textDim: "#8b93a7",
    gridLine: "#232a3a",
    tooltipBg: "#171c28",
    tooltipBorder: "#2f3850",
    tooltipText: "#e6e9f0",
    surface: "#11151f",
  },
  light: {
    palette: ["#2a78d6", "#1baf7a", "#eda100", "#4a3aa7", "#e34948", "#e87ba4"],
    textDim: "#5b6474",
    gridLine: "#e3e6eb",
    tooltipBg: "#ffffff",
    tooltipBorder: "#ccd2db",
    tooltipText: "#1a1f2b",
    surface: "#ffffff",
  },
};

type ChartTheme = (typeof CHART_THEMES)[ThemeName];

export function formatNumber(v: unknown): string {
  const n = Number(v);
  if (v === null || v === undefined || isNaN(n)) return String(v ?? "∅");
  return Intl.NumberFormat("en", {
    notation: Math.abs(n) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(n);
}

function baseOption(t: ChartTheme) {
  return {
    backgroundColor: "transparent",
    color: t.palette,
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText, fontSize: 12 },
      valueFormatter: (v: unknown) => formatNumber(v),
    },
    textStyle: { color: t.textDim, fontSize: 11 },
  };
}

function axisStyle(t: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: t.gridLine } },
    axisTick: { show: false },
    axisLabel: { color: t.textDim, fontSize: 11 },
    splitLine: { lineStyle: { color: t.gridLine } },
  };
}

function buildPieOption(spec: ChartSpec, result: QueryResult, t: ChartTheme, donut: boolean) {
  const x = spec.xField ?? result.columns[0]?.name;
  const y = spec.yFields[0] ?? result.columns[1]?.name;
  return {
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: "item" as const },
    legend: { bottom: 0, textStyle: { color: t.textDim, fontSize: 11 }, icon: "circle" },
    series: [
      {
        type: "pie",
        radius: donut ? ["58%", "80%"] : ["45%", "72%"],
        top: 0,
        bottom: 24,
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        label: { color: t.textDim, fontSize: 11 },
        data: result.rows.slice(0, 8).map((r) => ({ name: String(r[x]), value: Number(r[y]) })),
      },
    ],
  };
}

// Splits a gauge's 0..max range into good/warn/bad color stops from
// ChartThresholds — highIsBad decides which end of the range reads as bad.
// With no thresholds configured, the whole range stays neutral (gridLine).
function buildGaugeAxisColor(thresholds: ChartThresholds | null, max: number, t: ChartTheme): [number, string][] {
  const warn = thresholds?.warn ?? null;
  const crit = thresholds?.crit ?? null;
  if (warn === null && crit === null) return [[1, t.gridLine]];
  const highIsBad = thresholds?.highIsBad ?? true;
  const good = "var(--success)";
  const warnColor = "var(--warning)";
  const bad = "var(--destructive)";
  const colorsAsc = highIsBad ? [good, warnColor, bad] : [bad, warnColor, good];
  const points = [warn, crit].filter((n): n is number => n !== null).sort((a, b) => a - b);
  const segColors = points.length === 1 ? [colorsAsc[0], colorsAsc[2]] : colorsAsc;
  const boundaries = [...points.map((p) => Math.min(1, Math.max(0, p / max))), 1];
  return boundaries.map((b, i) => [b, segColors[i] ?? segColors[segColors.length - 1]]);
}

// No configurable min/max on ChartSpec yet, so the ceiling is a heuristic:
// 100 covers the common percentage case, otherwise 25% headroom over value.
function buildGaugeOption(spec: ChartSpec, result: QueryResult, t: ChartTheme) {
  const y = spec.yFields[0] ?? result.columns[0]?.name;
  const v = Number(result.rows[0]?.[y ?? ""] ?? 0);
  const max = v >= 0 && v <= 100 ? 100 : Math.max(10, Math.ceil((v * 1.25) / 10) * 10);
  return {
    ...baseOption(t),
    series: [
      {
        type: "gauge",
        min: 0,
        max,
        progress: { show: true, width: 14 },
        axisLine: { lineStyle: { width: 14, color: buildGaugeAxisColor(spec.thresholds, max, t) } },
        axisTick: { show: false },
        splitLine: { length: 10, lineStyle: { color: t.gridLine } },
        axisLabel: { color: t.textDim, fontSize: 10, distance: 14 },
        pointer: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          formatter: (val: number) => formatNumber(val),
          color: t.tooltipText,
          fontSize: 22,
          offsetCenter: [0, "0%"],
        },
        data: [{ value: v, name: y }],
      },
    ],
  };
}

// Heatmap needs three dimensions but ChartSpec only carries x/y/series — so it
// borrows seriesField as the second (row) axis instead of a series splitter,
// and yFields[0] as the cell's value metric.
function buildHeatmapOption(spec: ChartSpec, result: QueryResult, t: ChartTheme) {
  const xField = spec.xField ?? result.columns[0]?.name;
  const yField = spec.seriesField ?? result.columns[1]?.name;
  const valueField = spec.yFields[0] ?? result.columns[2]?.name ?? result.columns[1]?.name;
  const xCats = [...new Set(result.rows.map((r) => String(r[xField!])))].slice(0, 60);
  const yCats = [...new Set(result.rows.map((r) => String(r[yField!])))].slice(0, 30);
  const xIndex = new Map(xCats.map((v, i) => [v, i]));
  const yIndex = new Map(yCats.map((v, i) => [v, i]));
  const data: [number, number, number][] = [];
  let max = 0;
  for (const r of result.rows) {
    const xi = xIndex.get(String(r[xField!]));
    const yi = yIndex.get(String(r[yField!]));
    if (xi === undefined || yi === undefined) continue;
    const v = Number(r[valueField!]);
    data.push([xi, yi, v]);
    if (v > max) max = v;
  }
  return {
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: "item" as const },
    grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
    xAxis: { type: "category" as const, data: xCats, ...axisStyle(t), splitArea: { show: true } },
    yAxis: { type: "category" as const, data: yCats, ...axisStyle(t), splitArea: { show: true } },
    visualMap: {
      min: 0,
      max: max || 1,
      calculable: true,
      orient: "horizontal" as const,
      left: "center",
      bottom: 0,
      textStyle: { color: t.textDim, fontSize: 10 },
      inRange: { color: [t.surface, t.palette[0]] },
    },
    series: [
      {
        type: "heatmap",
        data,
        label: { show: false },
        itemStyle: { borderColor: t.surface, borderWidth: 1 },
      },
    ],
  };
}

// pivot rows by seriesField: one series per distinct seriesField value
function buildSeriesData(spec: ChartSpec, result: QueryResult) {
  const xField = spec.xField;
  const rows = [...result.rows];
  const temporal = xField && rows.every((r) => !isNaN(Date.parse(String(r[xField] ?? ""))));
  if (xField && temporal) {
    rows.sort((a, b) => Date.parse(String(a[xField])) - Date.parse(String(b[xField])));
  }
  const xValues = xField ? [...new Set(rows.map((r) => String(r[xField]).slice(0, temporal ? 10 : 60)))] : [];

  const series: { name: string; data: (number | null)[] }[] = [];
  if (spec.seriesField && spec.yFields.length === 1) {
    const y = spec.yFields[0];
    const groups = [...new Set(rows.map((r) => String(r[spec.seriesField!])))].slice(0, 6);
    for (const g of groups) {
      const byX = new Map(
        rows
          .filter((r) => String(r[spec.seriesField!]) === g)
          .map((r) => [String(r[xField!]).slice(0, temporal ? 10 : 60), Number(r[y])]),
      );
      series.push({ name: g, data: xValues.map((x) => byX.get(x) ?? null) });
    }
  } else {
    for (const y of spec.yFields) {
      const byX = new Map(rows.map((r) => [String(r[xField!]).slice(0, temporal ? 10 : 60), Number(r[y])]));
      series.push({ name: y, data: xValues.map((x) => byX.get(x) ?? null) });
    }
  }
  return { xValues, series, temporal: !!temporal };
}

export function ChartRenderer({
  spec,
  result,
  height = 300,
  onCrossFilter,
  onTimeRangeSelect,
  onReady,
}: {
  spec: ChartSpec;
  result: QueryResult;
  height?: number;
  // Called when a bar/pie/donut data point is clicked and its category field
  // matches a dashboard variable's name — the dashboard page owns the actual
  // variable state, this just reports "field X was clicked with value Y".
  onCrossFilter?: (field: string, value: string) => void;
  // Called when a drag-select on a temporal line/area/scatter chart settles —
  // reports the selected [from, to] as the same "yyyy-MM-dd" strings the
  // chart's own x-axis uses. The dashboard page decides whether there's a
  // datetime variable to update; this component doesn't know either way.
  onTimeRangeSelect?: (from: string, to: string) => void;
  // Called once the ECharts instance mounts, so the panel's export button can
  // rasterize it to PNG on demand.
  onReady?: (instance: EchartsExportHandle) => void;
}) {
  const themeName = useTheme();
  const t = CHART_THEMES[themeName];
  const router = useRouter();

  const seriesData = useMemo(() => buildSeriesData(spec, result), [spec, result]);
  const enableTimeBrush = TIME_BRUSH_TYPES.has(spec.chartType) && seriesData.temporal && !!onTimeRangeSelect;

  const option = useMemo(() => {
    if (spec.chartType === "stat" || spec.chartType === "table") return null;
    if (spec.chartType === "pie" || spec.chartType === "donut") {
      return buildPieOption(spec, result, t, spec.chartType === "donut");
    }
    if (spec.chartType === "gauge") return buildGaugeOption(spec, result, t);
    if (spec.chartType === "heatmap") return buildHeatmapOption(spec, result, t);

    const { xValues, series } = seriesData;
    const multi = series.length > 1;
    const horizontal = spec.chartType === "bar-horizontal";
    const categoryAxis = { type: "category" as const, data: xValues, ...axisStyle(t), splitLine: { show: false } };
    const valueAxis = {
      type: "value" as const,
      ...axisStyle(t),
      axisLine: { show: false },
      axisLabel: { ...axisStyle(t).axisLabel, formatter: (v: number) => formatNumber(v) },
    };
    const common = {
      ...baseOption(t),
      legend: multi ? { top: 0, left: 0, textStyle: { color: t.textDim, fontSize: 11 }, icon: "circle" } : undefined,
      xAxis: horizontal ? valueAxis : categoryAxis,
      yAxis: horizontal ? categoryAxis : valueAxis,
      // Lets the user drag directly across the plotted data to select a time
      // window (see the takeGlobalCursor dispatch in handleChartReady below,
      // which puts the chart in brush mode without needing a toolbox button).
      ...(enableTimeBrush
        ? {
            brush: {
              xAxisIndex: 0 as const,
              brushType: "lineX" as const,
              throttleType: "debounce" as const,
              throttleDelay: 300,
              removeOnClick: true,
            },
          }
        : {}),
    };
    if (spec.chartType === "bar" || spec.chartType === "bar-stacked" || spec.chartType === "bar-horizontal") {
      const stacked = spec.chartType === "bar-stacked";
      return {
        ...common,
        series: series.map((s) => ({
          name: s.name,
          type: "bar",
          data: s.data,
          stack: stacked ? "total" : undefined,
          barMaxWidth: 28,
          itemStyle: { borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
          barGap: "10%",
        })),
      };
    }
    if (spec.chartType === "scatter") {
      return {
        ...common,
        series: series.map((s) => ({
          name: s.name,
          type: "scatter",
          data: s.data,
          symbolSize: 8,
        })),
      };
    }
    // line / area / area-stacked
    const stacked = spec.chartType === "area-stacked";
    return {
      ...common,
      series: series.map((s) => ({
        name: s.name,
        type: "line",
        data: s.data,
        stack: stacked ? "total" : undefined,
        smooth: false,
        showSymbol: xValues.length <= 40,
        symbolSize: 6,
        lineStyle: { width: 2 },
        areaStyle: spec.chartType === "area" || stacked ? { opacity: stacked ? 0.5 : 0.18 } : undefined,
      })),
    };
  }, [spec, result, t, seriesData, enableTimeBrush]);

  const isAxisChart = ["line", "area", "area-stacked", "bar", "bar-stacked", "bar-horizontal", "scatter"].includes(
    spec.chartType,
  );
  // Axis charts with no X field would "render" a frame with zero points
  // (buildSeriesData yields no x values) — say why instead of showing an
  // empty chart. Pie is exempt: it falls back to the first column.
  const emptyReason =
    isAxisChart && !spec.xField
      ? "No X field selected"
      : spec.chartType !== "table" && spec.chartType !== "stat" && result.rows.length === 0
        ? "No data"
        : null;
  if (emptyReason) {
    return (
      <div
        className="flex items-center justify-center h-full text-[13px]"
        style={{ minHeight: height / 2, color: "var(--muted-foreground)" }}
      >
        {emptyReason}
      </div>
    );
  }

  if (spec.chartType === "stat") {
    const y = spec.yFields[0] ?? result.columns[0]?.name;
    // A manually-picked multi-row stat spec has no ORDER BY contract, but if
    // there IS more than one row, the caller almost always means "a series —
    // show me the latest point plus a sparkline/delta of the rest", so the
    // last row is the headline value (a single-row result is unaffected:
    // first === last).
    const values = result.rows.map((r) => Number(r[y ?? ""]));
    const v = result.rows[result.rows.length - 1]?.[y ?? ""];
    const numV = Number(v);
    const first = values[0];
    const last = values[values.length - 1];
    const hasDelta = values.length > 1 && Number.isFinite(first) && Number.isFinite(last);
    const delta = hasDelta ? last - first : null;
    const deltaPct = hasDelta && first !== 0 ? (delta! / Math.abs(first)) * 100 : null;

    let valueColor = "var(--foreground)";
    if (spec.thresholds && (spec.thresholds.warn !== null || spec.thresholds.crit !== null)) {
      const { warn, crit, highIsBad } = spec.thresholds;
      const isBad = (threshold: number) => (highIsBad ? numV >= threshold : numV <= threshold);
      if (crit !== null && isBad(crit)) valueColor = "var(--destructive)";
      else if (warn !== null && isBad(warn)) valueColor = "var(--warning)";
      else valueColor = "var(--success)";
    }
    // Default assumption (no thresholds configured, or highIsBad left at its
    // default): higher is good, e.g. revenue/users. Only flipped when
    // thresholds explicitly mark high values as bad (error rate, latency).
    const highIsBad = spec.thresholds?.highIsBad ?? false;
    const deltaGood = delta === null ? null : highIsBad ? delta <= 0 : delta >= 0;

    const sparklineOption =
      values.length > 1
        ? {
            grid: { left: 0, right: 0, top: 2, bottom: 2 },
            xAxis: { type: "category" as const, show: false, data: values.map((_, i) => i) },
            yAxis: { type: "value" as const, show: false },
            series: [
              {
                type: "line",
                data: values,
                showSymbol: false,
                lineStyle: { width: 1.5, color: t.palette[0] },
                areaStyle: { opacity: 0.12, color: t.palette[0] },
              },
            ],
          }
        : null;

    return (
      <div className="flex flex-col items-start justify-center h-full px-2 gap-1" style={{ minHeight: height / 2 }}>
        <div className="flex items-baseline gap-2">
          <div className="text-4xl font-semibold tracking-tight" style={{ color: valueColor }}>
            {formatNumber(v)}
          </div>
          {deltaPct !== null && (
            <span
              className="text-[12px] font-medium"
              style={{ color: deltaGood ? "var(--success)" : "var(--destructive)" }}
            >
              {delta! >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}%
            </span>
          )}
        </div>
        <div className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          {y}
        </div>
        {sparklineOption && (
          <ReactECharts option={sparklineOption} style={{ height: 32, width: "100%" }} notMerge opts={{ renderer: "svg" }} />
        )}
      </div>
    );
  }
  if (spec.chartType === "table" || !option) {
    const onRowClick = spec.linkTo
      ? (row: Record<string, unknown>) => {
          const link = spec.linkTo!;
          router.push(
            recordHref({
              connection: link.connection,
              schema: link.schema ?? undefined,
              table: link.table,
              params: { pk: JSON.stringify({ [link.keyColumn]: row[link.keyField] }) },
            }),
          );
        }
      : undefined;
    // ~24px footer (row count / duration) renders below the scroll region —
    // reserve it so the whole grid stays inside a fixed-height panel.
    return <ResultGrid result={result} maxRows={50} maxHeight={height - 24} onRowClick={onRowClick} />;
  }

  const crossFilterField = !CROSS_FILTER_TYPES.has(spec.chartType)
    ? null
    : spec.chartType === "pie" || spec.chartType === "donut"
      ? (spec.xField ?? result.columns[0]?.name ?? null)
      : spec.xField;

  const onEvents: Record<string, (params: never) => void> = {};
  if (onCrossFilter && crossFilterField) {
    onEvents.click = (params: { name?: string }) => {
      if (params.name) onCrossFilter(crossFilterField, params.name);
    };
  }
  if (enableTimeBrush) {
    // coordRange is the brush box's span in the x-axis's own data coordinates
    // — for a category axis that's fractional indices into xValues, not
    // dates, so round/clamp back to real indices before reading the dates out.
    onEvents.brushEnd = (params: { areas?: { coordRange?: [number, number] }[] }) => {
      const range = params?.areas?.[0]?.coordRange;
      const xValues = seriesData.xValues;
      if (!range || xValues.length === 0) return;
      const lo = Math.max(0, Math.min(xValues.length - 1, Math.round(Math.min(range[0], range[1]))));
      const hi = Math.max(0, Math.min(xValues.length - 1, Math.round(Math.max(range[0], range[1]))));
      const from = xValues[lo];
      const to = xValues[hi];
      if (from !== undefined && to !== undefined && from !== to) onTimeRangeSelect!(from, to);
    };
  }

  // Puts the chart in brush-select mode as soon as it mounts, so dragging
  // across the plotted data works immediately — no toolbox button to find
  // first (that's the "click, drag directly on the chart" gesture the
  // dashboard's Apply-gated date-range picker can't offer on its own).
  const handleChartReady = (inst: EchartsExportHandle) => {
    onReady?.(inst);
    if (enableTimeBrush) {
      inst.dispatchAction?.({ type: "takeGlobalCursor", key: "brush", brushOption: { brushType: "lineX", brushMode: "single" } });
    }
  };

  return (
    <ReactECharts
      key={themeName}
      option={option}
      style={{ height, width: "100%" }}
      notMerge
      onEvents={onEvents}
      onChartReady={handleChartReady}
    />
  );
}
