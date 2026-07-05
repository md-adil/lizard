"use client";

// Field controls to shape a ChartSpec against a known QueryResult.
import type { ChartSpec, ChartType, QueryResult } from "@/lib/types";

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
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Title</label>
        <input className="input" value={spec.title} onChange={(e) => onChange({ ...spec, title: e.target.value })} />
      </div>
      <div>
        <label className="label">Chart type</label>
        <div className="flex gap-1 flex-wrap">
          {TYPES.map((t) => (
            <button
              key={t}
              className="tag"
              style={spec.chartType === t ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}}
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
          <select
            className="input"
            value={spec.xField ?? ""}
            onChange={(e) => onChange({ ...spec, xField: e.target.value || null })}
          >
            <option value="">—</option>
            {cols.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
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
                  style={active ? { color: "var(--green)", borderColor: "var(--green)" } : {}}
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
          <select
            className="input"
            value={spec.seriesField ?? ""}
            onChange={(e) => onChange({ ...spec, seriesField: e.target.value || null })}
          >
            <option value="">—</option>
            {cols
              .filter((c) => !spec.yFields.includes(c) && c !== spec.xField)
              .map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
          </select>
        </div>
      )}
    </div>
  );
}
