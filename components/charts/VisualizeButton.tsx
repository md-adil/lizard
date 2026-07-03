"use client";

// One-click "Visualize" (Phase 5): turn any query result into a chart, tweak
// it live, and save it to a dashboard as a panel.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { ChartSpec, Dashboard, QueryRequest, QueryResult } from "@/lib/types";
import { suggestCharts } from "@/lib/charts/suggest";
import { ChartRenderer } from "./ChartRenderer";
import { SpecControls } from "./SpecControls";

export function VisualizeButton({ result, source }: { result: QueryResult; source: QueryRequest }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const suggestions = useMemo(() => suggestCharts(result), [result]);
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [dashboardId, setDashboardId] = useState("");
  const [newDashName, setNewDashName] = useState("");
  const [savedTo, setSavedTo] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: dashboards } = useQuery<Dashboard[]>({
    queryKey: ["dashboards"],
    queryFn: async () => (await fetch("/api/dashboards")).json(),
    enabled: open,
  });

  const openModal = () => {
    const best = suggestions[0];
    setSpec({
      title: "New chart",
      chartType: best.chartType,
      target: source.target,
      connections: source.connections,
      sql: source.sql,
      dialect: source.dialect,
      xField: best.xField,
      yFields: best.yFields,
      seriesField: best.seriesField,
    });
    setSavedTo(null);
    setOpen(true);
  };

  const addToDashboard = async () => {
    if (!spec) return;
    setSaving(true);
    try {
      let id = dashboardId;
      let name = dashboards?.find((d) => d.id === id)?.name ?? "";
      if (!id) {
        const res = await fetch("/api/dashboards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newDashName || "My dashboard" }),
        });
        const d = await res.json();
        id = d.id;
        name = d.name;
      }
      await fetch(`/api/dashboards/${id}/panels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      qc.invalidateQueries({ queryKey: ["dashboards"] });
      setSavedTo({ id, name });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button className="btn btn-sm" onClick={openModal}>
        📊 Visualize
      </button>
      {open && spec && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: "var(--overlay)" }} onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 inset-x-0 top-[6vh] mx-auto w-[880px] max-w-[94vw] panel p-5"
            style={{ background: "var(--bg-panel)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold">Visualize result</h3>
              <button className="btn btn-sm" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="flex gap-5">
              <div className="flex-1 min-w-0 panel p-3" style={{ background: "var(--bg)" }}>
                <div className="text-[13px] font-medium mb-2">{spec.title}</div>
                <ChartRenderer spec={spec} result={result} height={320} />
              </div>
              <div className="w-64 shrink-0">
                <SpecControls spec={spec} result={result} onChange={setSpec} />
                <div className="mt-5 pt-4 border-t">
                  <label className="label">Add to dashboard</label>
                  <select className="input mb-2" value={dashboardId} onChange={(e) => setDashboardId(e.target.value)}>
                    <option value="">＋ New dashboard…</option>
                    {dashboards?.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {!dashboardId && (
                    <input
                      className="input mb-2"
                      placeholder="Dashboard name"
                      value={newDashName}
                      onChange={(e) => setNewDashName(e.target.value)}
                    />
                  )}
                  {savedTo ? (
                    <Link href={`/dashboards/${savedTo.id}`} className="btn btn-primary w-full justify-center">
                      Saved ✓ — open “{savedTo.name}”
                    </Link>
                  ) : (
                    <button className="btn btn-primary w-full justify-center" disabled={saving} onClick={addToDashboard}>
                      {saving ? "Saving…" : "Add to dashboard"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
