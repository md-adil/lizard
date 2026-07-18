"use client";

// Chart-type picker used by spec-controls — a select whose trigger and items
// show an icon per chart type instead of a bare text label.
import { LineChart, AreaChart, BarChart3, PieChart, Gauge, Table2, type LucideIcon } from "lucide-react";
import type { ChartType } from "@/lib/types";
import { CHART_TYPES } from "@/lib/types";
import { DataSelect } from "@/components/ui/data-select";

const CHART_TYPE_ICONS: Record<ChartType, LucideIcon> = {
  line: LineChart,
  area: AreaChart,
  bar: BarChart3,
  pie: PieChart,
  stat: Gauge,
  table: Table2,
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
  return (
    <DataSelect
      items={TYPES}
      value={value}
      getValue={(t) => t}
      getLabel={(t) => {
        const Icon = CHART_TYPE_ICONS[t];
        return (
          <span className="flex items-center gap-1.5">
            <Icon className="size-3.5" />
            {CHART_TYPES[t].label}
          </span>
        );
      }}
      onChange={(t) => t && onChange(t)}
      size="sm"
      className={className}
    />
  );
}
