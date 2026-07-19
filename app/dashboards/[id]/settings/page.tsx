"use client";

// Dashboard-level configuration — separate from the view page on purpose:
// viewing/arranging panels is one surface, defining what the dashboard IS
// (its name, refresh cadence, variables) is another. Mirrors Grafana's
// dashboard settings page rather than bolting config controls onto the view.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Dashboard, DashboardVariable } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AutoRefreshSelect } from "@/components/ui/auto-refresh-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { VariableFormCard } from "@/components/charts/variable-form-card";
import { useDashboards } from "@/components/charts/use-dashboards";
import { Breadcrumbs } from "@/components/breadcrumbs";

const VAR_TYPE_LABEL: Record<DashboardVariable["type"], string> = {
  text: "Text",
  select: "Select",
  daterange: "Date range",
};

export default function DashboardSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ variable: DashboardVariable; index: number } | "new" | null>(null);

  const { data: dash } = useQuery<Dashboard>({
    queryKey: ["dashboard", id],
    queryFn: async () => {
      const res = await fetch(`/api/dashboards/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body;
    },
  });

  useEffect(() => {
    if (dash) setName(dash.name);
  }, [dash?.id, dash?.name]);

  const patch = async (fields: { name?: string; refreshSeconds?: number | null; variables?: DashboardVariable[] }) => {
    await fetch(`/api/dashboards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    qc.invalidateQueries({ queryKey: ["dashboard", id] });
    useDashboards.invalidate(qc);
  };

  const removeVariable = (i: number) => {
    if (!dash) return;
    patch({ variables: dash.variables.filter((_, idx) => idx !== i) });
  };

  const upsertVariable = async (variable: DashboardVariable) => {
    if (!dash) return;
    const index = editing !== "new" && editing ? editing.index : null;
    const next =
      index === null
        ? [...dash.variables, variable]
        : dash.variables.map((v, idx) => (idx === index ? variable : v));
    await patch({ variables: next });
    setEditing(null);
  };

  // There's only one dashboard-wide date range (like Grafana's built-in time
  // picker) — hide the option once one exists, unless we're editing that
  // very variable.
  const hasDateRange = dash?.variables.some((v) => v.type === "daterange") ?? false;
  const editingIsDateRange = editing !== "new" && editing?.variable.type === "daterange";

  if (!dash) {
    return (
      <div className="px-6 py-6 space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-3xl">
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: "Home", link: "/" },
          { label: "Dashboards", link: "/dashboards" },
          { label: dash.name, link: `/dashboards/${id}` },
          { label: "Settings" },
        ]}
      />
      <h1 className="text-lg font-semibold mb-5">Dashboard settings</h1>

      <Tabs defaultValue="general">
        <TabsList className="mb-5">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="variables">Variables</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card className="p-4 space-y-4">
            <div>
              <label className="label">Name</label>
              <Input
                className="max-w-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name !== dash.name && patch({ name })}
              />
            </div>
            <div>
              <label className="label">Auto-refresh</label>
              <div>
                <AutoRefreshSelect
                  value={(dash.refreshSeconds ?? 0) * 1000}
                  onChange={(ms) => patch({ refreshSeconds: ms === 0 ? null : ms / 1000 })}
                />
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="variables" className="space-y-3">
          {dash.variables.length === 0 && (
            <Card className="px-6 py-10 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              No variables yet. Variables let a viewer filter every panel at once — add one and reference it in a
              panel's SQL as <span className="code">{"{{name}}"}</span>.
            </Card>
          )}
          {dash.variables.map((v, i) =>
            editing !== "new" && editing?.index === i ? (
              <VariableFormCard
                key={i}
                initial={editing.variable}
                disableDateRange={hasDateRange && !editingIsDateRange}
                onCancel={() => setEditing(null)}
                onSave={upsertVariable}
              />
            ) : (
              <Card key={i} className="p-3 flex-row items-center gap-2">
                <span className="text-[13px] font-medium">{v.label || v.name}</span>
                <span className="text-[11px] code" style={{ color: "var(--muted-foreground-faint)" }}>
                  {v.type === "daterange" ? `{{${v.name}.from}}/{{${v.name}.to}}` : `{{${v.name}}}`}
                </span>
                <span className="tag" style={{ fontSize: 10 }}>
                  {VAR_TYPE_LABEL[v.type]}
                </span>
                {v.type === "select" && (
                  <span className="text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
                    {v.source.kind === "static" ? `${v.source.options.length} option(s)` : "from query"}
                  </span>
                )}
                <span className="flex-1" />
                <Button variant="secondary" size="sm" onClick={() => setEditing({ variable: v, index: i })}>
                  ✎ Edit
                </Button>
                <Button variant="secondary" size="sm" aria-label="Remove variable" onClick={() => removeVariable(i)}>
                  ✕
                </Button>
              </Card>
            ),
          )}
          {editing === "new" && (
            <VariableFormCard
              initial={null}
              disableDateRange={hasDateRange}
              onCancel={() => setEditing(null)}
              onSave={upsertVariable}
            />
          )}
          {editing === null && (
            <Button variant="secondary" onClick={() => setEditing("new")}>
              ＋ Add variable
            </Button>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
