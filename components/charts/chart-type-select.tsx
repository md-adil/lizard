"use client";

// Chart-type picker used by spec-controls — searchable now that there are 13
// types (a plain select got unwieldy), with a colorful icon per row so types
// scan at a glance instead of by reading text.
import {
  LineChart,
  AreaChart,
  Layers,
  BarChart3,
  ChartBarStacked,
  BarChartHorizontal,
  ChartScatter,
  PieChart,
  Donut,
  Grid3x3,
  CircleGauge,
  Gauge,
  Table2,
  type LucideIcon,
} from "lucide-react";
import type { ChartType } from "@/lib/types";
import { CHART_TYPES } from "@/lib/types";
import { useTheme } from "@/components/useTheme";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";

const CHART_TYPE_ICONS: Record<ChartType, LucideIcon> = {
  line: LineChart,
  area: AreaChart,
  "area-stacked": Layers,
  bar: BarChart3,
  "bar-stacked": ChartBarStacked,
  "bar-horizontal": BarChartHorizontal,
  scatter: ChartScatter,
  pie: PieChart,
  donut: Donut,
  heatmap: Grid3x3,
  gauge: CircleGauge,
  stat: Gauge,
  table: Table2,
};

// Decorative per-type accents so rows scan by shape+color, not just text —
// not data-series encoding, so pairwise CVD separation isn't load-bearing
// here. First six reuse the app's validated chart palette (chart-renderer.tsx
// CHART_THEMES) so a type's icon matches its actual rendered chart color.
const CHART_TYPE_COLORS: Record<ChartType, { dark: string; light: string }> = {
  line: { dark: "#3987e5", light: "#2a78d6" },
  area: { dark: "#199e70", light: "#1baf7a" },
  "area-stacked": { dark: "#14b8a6", light: "#128a9e" },
  bar: { dark: "#c98500", light: "#eda100" },
  "bar-stacked": { dark: "#e0793d", light: "#c2620a" },
  "bar-horizontal": { dark: "#d4b106", light: "#a8890a" },
  scatter: { dark: "#9085e9", light: "#4a3aa7" },
  pie: { dark: "#e66767", light: "#e34948" },
  donut: { dark: "#d55181", light: "#e87ba4" },
  heatmap: { dark: "#c44fd9", light: "#a730ba" },
  gauge: { dark: "#22b8cf", light: "#0e7490" },
  stat: { dark: "#64748b", light: "#475569" },
  table: { dark: "#8a97ab", light: "#64748b" },
};

const TYPES = Object.keys(CHART_TYPES) as ChartType[];

export function ChartTypeSelect({
  value,
  onChange,
  className = "w-full",
}: {
  value: ChartType;
  onChange: (type: ChartType) => void;
  className?: string;
}) {
  const theme = useTheme();
  return (
    <Combobox<ChartType>
      items={TYPES}
      value={value}
      onValueChange={(t) => t && onChange(t)}
      itemToStringLabel={(t) => CHART_TYPES[t].label}
    >
      <ComboboxInput className={className} />
      <ComboboxContent>
        <ComboboxEmpty>No chart types found</ComboboxEmpty>
        <ComboboxList>
          {(type: ChartType) => {
            const Icon = CHART_TYPE_ICONS[type];
            return (
              <ComboboxItem key={type} value={type}>
                <Icon className="size-3.5 shrink-0" style={{ color: CHART_TYPE_COLORS[type][theme] }} />
                {CHART_TYPES[type].label}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
