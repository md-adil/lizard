"use client";

// Field controls to shape a ChartSpec against a known QueryResult.
import { useMemo } from "react";
import type { ChartSpec, ChartType, QueryResult } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { ColumnsSelect } from "@/components/browse/columns-select";

const TYPES: ChartType[] = ["line", "area", "bar", "pie", "stat", "table"];

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
    <div className="space-y-3">
      <div>
        <label className="label">Title</label>
        <Input value={spec.title} onChange={(e) => onChange({ ...spec, title: e.target.value })} />
      </div>
      <div>
        <label className="label">Chart type</label>
        <div className="flex gap-1 flex-wrap">
          {TYPES.map((t) => (
            <button
              key={t}
              className="tag"
              style={spec.chartType === t ? { color: "var(--primary)", borderColor: "var(--primary)" } : {}}
              onClick={() => onChange({ ...spec, chartType: t })}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {!["stat", "table"].includes(spec.chartType) && (
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
      {spec.chartType !== "table" && (
        <div>
          <label className="label">{spec.chartType === "pie" ? "Value field" : "Y fields"}</label>
          <div className="flex gap-1 flex-wrap">
            {cols.map((c) => {
              const active = spec.yFields.includes(c);
              return (
                <button
                  key={c}
                  className="tag"
                  style={active ? { color: "var(--success)", borderColor: "var(--success)" } : {}}
                  onClick={() =>
                    onChange({
                      ...spec,
                      yFields: active ? spec.yFields.filter((y) => y !== c) : [...spec.yFields, c].slice(0, 6),
                    })
                  }
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {["line", "area", "bar"].includes(spec.chartType) && spec.yFields.length === 1 && (
        <div>
          <label className="label">Split into series by (optional)</label>
          <ColumnsSelect
            items={result.columns.filter((c) => !spec.yFields.includes(c.name) && c.name !== spec.xField)}
            value={(spec.seriesField ? columnsByName.get(spec.seriesField) : null) ?? null}
            onChange={(col) => onChange({ ...spec, seriesField: col?.name ?? null })}
            placeholder="—"
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}
