"use client";

// One-click "Visualize" (Phase 5): turn any query result into a chart, tweak
// it live, and save it to a dashboard as a panel.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { ChartSpec, QueryRequest, QueryResult } from "@/lib/types";
import { suggestCharts } from "@/lib/charts/suggest";
import { ChartRenderer } from "./chart-renderer";
import { SpecControls } from "./spec-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataSelect } from "@/components/ui/data-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDashboards } from "./use-dashboards";

export function VisualizeButton({ result, source }: { result: QueryResult; source: QueryRequest }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const suggestions = useMemo(() => suggestCharts(result), [result]);
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [dashboardId, setDashboardId] = useState("");
  const [newDashName, setNewDashName] = useState("");
  const [savedTo, setSavedTo] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: dashboards } = useDashboards({ enabled: open });
  const dashboardOptions = useMemo(
    () => [
      { value: "new", label: "＋ New dashboard…" },
      ...(dashboards?.map((d) => ({ value: d.id, label: d.name })) ?? []),
    ],
    [dashboards],
  );

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
      linkTo: null,
      thresholds: null,
      cacheSeconds: null,
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
      useDashboards.invalidate(qc);
      setSavedTo({ id, name });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openModal}>
        📊 Visualize
      </Button>
      {open && spec && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent showCloseButton className="w-220 max-w-[94vw] sm:max-w-[94vw] p-5">
            <DialogHeader>
              <DialogTitle>Visualize result</DialogTitle>
            </DialogHeader>
            <div className="flex gap-5">
              <div className="flex-1 min-w-0 panel p-3" style={{ background: "var(--background)" }}>
                <div className="text-[13px] font-medium mb-2">{spec.title}</div>
                <ChartRenderer spec={spec} result={result} height={320} />
              </div>
              <div className="w-64 shrink-0">
                <SpecControls spec={spec} result={result} onChange={setSpec} />
                <div className="mt-5 pt-4 border-t">
                  <label className="label">Add to dashboard</label>
                  <DataSelect
                    items={dashboardOptions}
                    value={dashboardOptions.find((o) => o.value === (dashboardId || "new")) ?? null}
                    onChange={(o) => setDashboardId(!o || o.value === "new" ? "" : o.value)}
                    className="mb-2 w-full"
                  />
                  {!dashboardId && (
                    <Input
                      className="mb-2"
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
                    <Button className="w-full justify-center" disabled={saving} onClick={addToDashboard}>
                      {saving ? "Saving…" : "Add to dashboard"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
