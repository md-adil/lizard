"use client";

// Field controls to shape a ChartSpec against a known QueryResult. Rendered
// as a narrow, full-height rail (Grafana's panel-options sidebar) — grouped
// into labeled sections rather than one flat stack.
import { useMemo } from "react";
import type { ChartSpec, ChartType, QueryResult } from "@/lib/types";
import { CHART_TYPES } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ColumnsSelect } from "@/components/browse/columns-select";
import { ChartTypeSelect } from "@/components/charts/chart-type-select";

// Label sits outside its own bordered box — the same outside-label pattern
// as the modal's "Data source"/"Preview" blocks, rather than one shared card
// with internal section dividers.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div
        className="text-[11px] font-semibold tracking-wide uppercase"
        style={{ color: "var(--muted-foreground-faint)" }}
      >
        {title}
      </div>
      <div className="panel p-3 space-y-2.5" style={{ background: "var(--background)" }}>
        {children}
      </div>
    </div>
  );
}

export function SpecControls({
  spec,
  result,
  onChange,
}: {
  spec: ChartSpec;
  result: QueryResult;
  onChange: (spec: ChartSpec) => void;
}) {
  const cols = result.columns.map((c) => c.name);
  const columnsByName = useMemo(() => new Map(result.columns.map((c) => [c.name, c])), [result.columns]);
  return (
    <div className="space-y-4">
      <Section title="Panel">
        <div>
          <label className="label">Title</label>
          <Input value={spec.title} onChange={(e) => onChange({ ...spec, title: e.target.value })} />
        </div>
        <div>
          <label className="label">Chart type</label>
          <ChartTypeSelect value={spec.chartType} onChange={(chartType) => onChange({ ...spec, chartType })} />
        </div>
      </Section>

      {/* "table" has no configurable fields — X field is hidden and Y fields
          only render for non-table types, so the whole section would just be
          an empty box for it. */}
      {spec.chartType !== "table" && (
        <Section title="Fields">
          {CHART_TYPES[spec.chartType].needsXField && (
            <div>
              <label className="label">X field</label>
              <ColumnsSelect
                items={result.columns}
                value={(spec.xField ? columnsByName.get(spec.xField) : null) ?? null}
                onChange={(col) => onChange({ ...spec, xField: col?.name ?? null })}
                placeholder="—"
                className="w-full"
              />
            </div>
          )}
          <div>
            <label className="label">{CHART_TYPES[spec.chartType].singleValueField ? "Value field" : "Y fields"}</label>
            <div className="flex gap-1.5 flex-wrap max-h-32 overflow-y-auto scrollbar-thin p-0.5">
              {cols.map((c) => {
                const active = spec.yFields.includes(c);
                return (
                  <Badge
                    key={c}
                    variant={active ? "default" : "outline"}
                    className={active ? undefined : "bg-muted"}
                    render={
                      <button
                        onClick={() =>
                          onChange({
                            ...spec,
                            yFields: active ? spec.yFields.filter((y) => y !== c) : [...spec.yFields, c].slice(0, 6),
                          })
                        }
                      />
                    }
                  >
                    {c}
                  </Badge>
                );
              })}
            </div>
          </div>
          {(spec.chartType === "heatmap" ||
            (["line", "area", "area-stacked", "bar", "bar-stacked", "bar-horizontal"].includes(spec.chartType) &&
              spec.yFields.length === 1)) && (
            <div>
              <label className="label">
                {spec.chartType === "heatmap" ? "Y field (rows)" : "Split into series by (optional)"}
              </label>
              <ColumnsSelect
                items={result.columns.filter((c) => !spec.yFields.includes(c.name) && c.name !== spec.xField)}
                value={(spec.seriesField ? columnsByName.get(spec.seriesField) : null) ?? null}
                onChange={(col) => onChange({ ...spec, seriesField: col?.name ?? null })}
                placeholder="—"
                className="w-full"
              />
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
