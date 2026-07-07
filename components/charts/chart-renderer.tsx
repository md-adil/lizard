"use client";

// Renders a ChartSpec + QueryResult with ECharts, themed to Lizard's UI.
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ChartSpec, QueryResult } from "@/lib/types";
import { ResultGrid } from "@/components/ai/result-grid";
import { useTheme, type ThemeName } from "@/components/useTheme";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// Both palettes validated with the dataviz six-checks validator against their
// surface (#11151f dark, #ffffff light). Fixed assignment order, never cycled.
const CHART_THEMES: Record<
  ThemeName,
  { palette: string[]; textDim: string; gridLine: string; tooltipBg: string; tooltipBorder: string; tooltipText: string; surface: string }
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
  return Intl.NumberFormat("en", { notation: Math.abs(n) >= 10000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(n);
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
        rows.filter((r) => String(r[spec.seriesField!]) === g).map((r) => [String(r[xField!]).slice(0, temporal ? 10 : 60), Number(r[y])])
      );
      series.push({ name: g, data: xValues.map((x) => byX.get(x) ?? null) });
    }
  } else {
    for (const y of spec.yFields) {
      const byX = new Map(rows.map((r) => [String(r[xField!]).slice(0, temporal ? 10 : 60), Number(r[y])]));
      series.push({ name: y, data: xValues.map((x) => byX.get(x) ?? null) });
    }
  }
  return { xValues, series };
}

export function ChartRenderer({ spec, result, height = 300 }: { spec: ChartSpec; result: QueryResult; height?: number }) {
  const themeName = useTheme();
  const t = CHART_THEMES[themeName];

  const option = useMemo(() => {
    if (spec.chartType === "stat" || spec.chartType === "table") return null;
    if (spec.chartType === "pie") {
      const x = spec.xField ?? result.columns[0]?.name;
      const y = spec.yFields[0] ?? result.columns[1]?.name;
      return {
        ...baseOption(t),
        tooltip: { ...baseOption(t).tooltip, trigger: "item" as const },
        legend: { bottom: 0, textStyle: { color: t.textDim, fontSize: 11 }, icon: "circle" },
        series: [
          {
            type: "pie",
            radius: ["45%", "72%"],
            top: 0,
            bottom: 24,
            itemStyle: { borderColor: t.surface, borderWidth: 2 },
            label: { color: t.textDim, fontSize: 11 },
            data: result.rows.slice(0, 8).map((r) => ({ name: String(r[x]), value: Number(r[y]) })),
          },
        ],
      };
    }

    const { xValues, series } = buildSeriesData(spec, result);
    const multi = series.length > 1;
    const common = {
      ...baseOption(t),
      legend: multi ? { top: 0, left: 0, textStyle: { color: t.textDim, fontSize: 11 }, icon: "circle" } : undefined,
      xAxis: { type: "category" as const, data: xValues, ...axisStyle(t), splitLine: { show: false } },
      yAxis: {
        type: "value" as const,
        ...axisStyle(t),
        axisLine: { show: false },
        axisLabel: { ...axisStyle(t).axisLabel, formatter: (v: number) => formatNumber(v) },
      },
    };
    if (spec.chartType === "bar") {
      return {
        ...common,
        series: series.map((s) => ({
          name: s.name,
          type: "bar",
          data: s.data,
          barMaxWidth: 28,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          barGap: "10%",
        })),
      };
    }
    // line / area
    return {
      ...common,
      series: series.map((s) => ({
        name: s.name,
        type: "line",
        data: s.data,
        smooth: false,
        showSymbol: xValues.length <= 40,
        symbolSize: 6,
        lineStyle: { width: 2 },
        areaStyle: spec.chartType === "area" ? { opacity: 0.18 } : undefined,
      })),
    };
  }, [spec, result, t]);

  if (spec.chartType === "stat") {
    const y = spec.yFields[0] ?? result.columns[0]?.name;
    const v = result.rows[result.rows.length - 1]?.[y ?? ""];
    return (
      <div className="flex flex-col items-start justify-center h-full px-2" style={{ minHeight: height / 2 }}>
        <div className="text-4xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
          {formatNumber(v)}
        </div>
        <div className="text-[12px] mt-1" style={{ color: "var(--muted-foreground)" }}>
          {y}
        </div>
      </div>
    );
  }
  if (spec.chartType === "table" || !option) {
    return <ResultGrid result={result} maxRows={50} />;
  }
  return <ReactECharts key={themeName} option={option} style={{ height, width: "100%" }} notMerge />;
}
