"use client";

// Dashboard-level configuration — separate from the view page on purpose:
// viewing/arranging panels is one surface, defining what the dashboard IS
// (its name, refresh cadence, variables) is another. Mirrors Grafana's
// dashboard settings page rather than bolting config controls onto the view.
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import type { Dashboard, DashboardVariable } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AutoRefreshSelect } from "@/components/ui/auto-refresh-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { VariableFormCard } from "@/components/charts/variable-form-card";
import { useDashboards } from "@/components/charts/use-dashboards";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { downloadBlob } from "@/lib/csv";
import { toDashboardExport, parseDashboardExport, type DashboardExport } from "@/lib/dashboard-export";

// Excludes "daterange": the dashboard's time range is a built-in feature
// (see app/dashboards/[id]/page.tsx), not a variable managed on this page.
const VAR_TYPE_LABEL: Record<Exclude<DashboardVariable["type"], "daterange">, string> = {
  text: "Text",
  select: "Select",
};

export default function DashboardSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ variable: DashboardVariable; index: number } | "new" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<DashboardExport | null>(null);
  const [importing, setImporting] = useState(false);

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

  // Grafana's "Export dashboard JSON" — a portable definition (name,
  // refresh, variables, panels) with no instance-specific ids.
  const exportJson = () => {
    if (!dash) return;
    const json = JSON.stringify(toDashboardExport(dash), null, 2);
    const filename = `${
      dash.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "dashboard"
    }.json`;
    downloadBlob(json, "application/json", filename);
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets picking the same file again re-fire onChange
    if (!file) return;
    try {
      setPendingImport(parseDashboardExport(await file.text()));
    } catch (err) {
      toast(err instanceof Error ? `Invalid dashboard JSON: ${err.message}` : "Invalid dashboard JSON");
    }
  };

  // Destructive — replaces this dashboard's name/refresh/variables and
  // deletes every existing panel in favor of the imported ones. Confirmed via
  // the AlertDialog below before this ever runs.
  const performImport = async () => {
    if (!dash || !pendingImport) return;
    setImporting(true);
    try {
      await patch({
        name: pendingImport.name,
        refreshSeconds: pendingImport.refreshSeconds,
        variables: pendingImport.variables,
      });
      await Promise.all(dash.panels.map((p) => fetch(`/api/panels/${p.id}`, { method: "DELETE" })));
      const results = await Promise.allSettled(
        pendingImport.panels.map((p) =>
          fetch(`/api/dashboards/${id}/panels`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spec: p.spec, pos: { x: p.x, y: p.y, w: p.w, h: p.h } }),
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)).length;
      qc.invalidateQueries({ queryKey: ["dashboard", id] });
      useDashboards.invalidate(qc);
      toast(failed > 0 ? `Imported with ${failed} panel(s) failing` : "Dashboard imported");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      setPendingImport(null);
    }
  };

  // Filters out any legacy "daterange" entries from before the time range
  // became a built-in dashboard feature instead of a variable — nothing
  // should still be creating these, but old stored data might have one.
  const variables = (dash?.variables ?? []).filter((v) => v.type !== "daterange");

  const removeVariable = (i: number) => {
    if (!dash) return;
    patch({ variables: variables.filter((_, idx) => idx !== i) });
  };

  const upsertVariable = async (variable: DashboardVariable) => {
    if (!dash) return;
    const index = editing !== "new" && editing ? editing.index : null;
    const next = index === null ? [...variables, variable] : variables.map((v, idx) => (idx === index ? variable : v));
    await patch({ variables: next });
    setEditing(null);
  };

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
          <Card className="p-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="dashboard-name">Name</FieldLabel>
                <Input
                  id="dashboard-name"
                  className="max-w-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => name.trim() && name !== dash.name && patch({ name })}
                />
              </Field>
              <Field>
                <FieldLabel>Auto-refresh</FieldLabel>
                <div className="w-fit">
                  <AutoRefreshSelect
                    value={(dash.refreshSeconds ?? 0) * 1000}
                    onChange={(ms) => patch({ refreshSeconds: ms === 0 ? null : ms / 1000 })}
                  />
                </div>
              </Field>
            </FieldGroup>
          </Card>

          <Card className="p-4">
            <div className="text-[13px] font-semibold">Import / export</div>
            <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
              Export this dashboard (name, refresh, variables, panels) as portable JSON, or import a previously exported
              file to replace this dashboard's panels and settings.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={exportJson}>
                <Download className="size-3.5" /> Export JSON
              </Button>
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-3.5" /> Import JSON
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={onFileSelected}
              />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="variables" className="space-y-3">
          {variables.length === 0 && (
            <Card className="px-6 py-10 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              No variables yet. Variables let a viewer filter every panel at once — add one and reference it in a
              panel's SQL as <span className="code">{"${name}"}</span>.
            </Card>
          )}
          {variables.map((v, i) =>
            editing !== "new" && editing?.index === i ? (
              <VariableFormCard
                key={i}
                initial={editing.variable}
                onCancel={() => setEditing(null)}
                onSave={upsertVariable}
              />
            ) : (
              <Card key={i} className="p-3 flex-row items-center gap-2">
                <span className="text-[13px] font-medium">{v.label || v.name}</span>
                <span className="text-[11px] code" style={{ color: "var(--muted-foreground-faint)" }}>
                  {`\${${v.name}}`}
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
            <VariableFormCard initial={null} onCancel={() => setEditing(null)} onSave={upsertVariable} />
          )}
          {editing === null && (
            <Button variant="secondary" onClick={() => setEditing("new")}>
              ＋ Add variable
            </Button>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!pendingImport} onOpenChange={(o) => !o && setPendingImport(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace this dashboard?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes all {dash.panels.length} existing panel{dash.panels.length === 1 ? "" : "s"} and replaces
              them with {pendingImport?.panels.length ?? 0} from "{pendingImport?.name}", and overwrites this
              dashboard's name, refresh interval, and variables. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={importing} onClick={performImport}>
              {importing ? "Importing…" : "Replace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
