"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GridLayout, useContainerWidth, type Layout, type GridLayoutProps } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import Link from "next/link";
import { Settings2, GripVertical, Pin, Download, Edit } from "lucide-react";
import type { ChartSpec, Dashboard, DashboardVariable, Panel, QueryResult, SqlDialect } from "@/lib/types";
import { ChartRenderer, type EchartsExportHandle } from "@/components/charts/chart-renderer";
import { SpecControls } from "@/components/charts/spec-controls";
import { ResultGrid } from "@/components/ai/result-grid";
import { VariableValueControl } from "@/components/charts/variable-controls";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SqlEditor, SqlCode } from "@/components/ui/sql-editor";
import { DataSelect } from "@/components/ui/data-select";
import { AutoRefreshSelect } from "@/components/ui/auto-refresh-select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCatalog } from "@/components/browse/use-catalog";
import { useDashboards } from "@/components/charts/use-dashboards";
import {
  substituteVariables,
  applySearchParamsToVariables,
  withVariablesInSearchParams,
  applySearchParamsToDatetime,
  withDatetimeInSearchParams,
  defaultDatetimeVariable,
} from "@/lib/dashboard-variables";
import { resultToCsv, downloadBlob } from "@/lib/csv";

const SQL_TARGET_OPTIONS: { value: "single" | "federated"; label: string }[] = [
  { value: "single", label: "single" },
  { value: "federated", label: "federated" },
];

const UNDO_DELAY_MS = 5000;
// Module-level, not component state — a setTimeout survives unmount, but if
// the id→timeout mapping lived in useState/useRef, navigating away before
// the undo window closes would lose the ability to know the delete is still
// pending (see the same pattern in app/dashboards/page.tsx for dashboards).
const pendingPanelDeletes = new Map<string, ReturnType<typeof setTimeout>>();

function PanelCard({
  panel,
  refreshSeconds,
  variables,
  editable,
  otherDashboards,
  onDelete,
  onEdit,
  onDuplicate,
  onCopyTo,
  onCrossFilter,
  onTimeRangeSelect,
}: {
  panel: Panel;
  refreshSeconds: number | null;
  // Current values of the dashboard's variables — substituted into spec.sql
  // (${name} tokens) before every fetch, and part of the query key so
  // changing one refetches only the panels whose SQL actually uses it... in
  // practice all panels share one key shape, so all refetch, but only the
  // ones referencing the token see different SQL.
  variables: DashboardVariable[];
  // Dashboard edit mode: the drag handle and the panel menu (edit / duplicate
  // / delete) only exist while editing — view mode is a clean read surface.
  editable: boolean;
  otherDashboards: Dashboard[];
  onDelete: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onCopyTo: (dashboardId: string, dashboardName: string) => void;
  onCrossFilter: (field: string, value: string) => void;
  onTimeRangeSelect: (from: string, to: string) => void;
}) {
  const qc = useQueryClient();
  const { spec } = panel;
  const chartRef = useRef<EchartsExportHandle | null>(null);
  const { data, error, isLoading } = useQuery<QueryResult>({
    queryKey: ["panel", panel.id, spec.sql, spec.connections, spec.cacheSeconds, variables],
    queryFn: async () => {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: spec.target,
          connections: spec.connections,
          sql: substituteVariables(spec.sql, variables),
          dialect: spec.dialect,
          cacheSeconds: spec.cacheSeconds ?? undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "query failed");
      return body;
    },
    staleTime: 30_000,
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });

  // PNG export only makes sense for the ECharts-backed types — table/stat
  // render through ResultGrid/plain markup, not an echarts instance.
  const canExportImage = spec.chartType !== "table" && spec.chartType !== "stat";
  const exportCsv = () => {
    if (!data) return;
    downloadBlob(resultToCsv(data), "text/csv;charset=utf-8", `${spec.title || "panel"}.csv`);
  };
  const exportPng = () => {
    if (!chartRef.current) return;
    const url = chartRef.current.getDataURL({ pixelRatio: 2 });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.title || "panel"}.png`;
    a.click();
  };

  return (
    <div className="panel p-3 flex flex-col min-w-0 h-full w-full overflow-hidden">
      <div className="flex items-center gap-1.5 mb-2">
        {/* GridLayout's dragConfig.handle targets this class — whole-card drag
            would fight ECharts' pointer handling and the scrollable grid. */}
        {editable && (
          <span
            className="drag-handle shrink-0 cursor-grab active:cursor-grabbing"
            style={{ color: "var(--muted-foreground-faint)", touchAction: "none" }}
            aria-label="Drag to move panel"
          >
            <GripVertical className="size-3.5" />
          </span>
        )}
        <span className="text-[13px] font-medium truncate">{spec.title}</span>
        {spec.connections.map((c) => (
          <span key={c} className="tag" style={{ fontSize: 10 }}>
            {c}
          </span>
        ))}
        <span className="flex-1" />
        {/* Export stays available in view mode too — it's a read action, not
            an edit one. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="secondary" size="sm" aria-label="Export panel" title="Export" />}
          >
            <Download className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem disabled={!data} onClick={exportCsv}>
              ⤓ Export CSV
            </DropdownMenuItem>
            {canExportImage && (
              <DropdownMenuItem disabled={!data} onClick={exportPng}>
                ⤓ Export image
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="secondary" size="sm" aria-label="Panel options" />}>
              ⋮
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onEdit}>✎ Edit panel</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>⧉ Duplicate</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>⧉ Copy to dashboard</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {otherDashboards.length === 0 && <DropdownMenuItem disabled>No other dashboards</DropdownMenuItem>}
                  {otherDashboards.map((d) => (
                    <DropdownMenuItem key={d.id} onClick={() => onCopyTo(d.id, d.name)}>
                      {d.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => qc.invalidateQueries({ queryKey: ["panel", panel.id] })}>
                ↻ Refresh data
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" className="justify-center" onClick={onDelete}>
                Delete panel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {isLoading && <Skeleton className="h-full w-full" />}
        {error && (
          <p className="text-[12.5px] px-1" style={{ color: "var(--destructive)" }}>
            {(error as Error).message}
          </p>
        )}
        {/* Real pixel height of an h-row grid item is h*rowHeight + (h-1)*margin
            (40/12, see gridConfig) — minus card padding + header ≈ 76px. The
            old h*40-60 under-sized content more the taller the panel got. */}
        {data && (
          <ChartRenderer
            spec={spec}
            result={data}
            height={panel.h * 52 - 76}
            onCrossFilter={onCrossFilter}
            onTimeRangeSelect={onTimeRangeSelect}
            onReady={(inst) => {
              chartRef.current = inst;
            }}
          />
        )}
      </div>
    </div>
  );
}

// AI panel authoring ("Describe it") is parked until the dashboard work ships
// — flip this to true to launch it. The tab/content code below stays compiled
// so it can't rot in the meantime.
const AI_PANEL_ENABLED = false;

function AddPanelModal({
  dashboardId,
  variables,
  onClose,
}: {
  dashboardId: string;
  variables: DashboardVariable[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"ai" | "sql">(AI_PANEL_ENABLED ? "ai" : "sql");
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [sql, setSql] = useState("");
  const [sqlTarget, setSqlTarget] = useState<"single" | "federated">("single");
  const [sqlConns, setSqlConns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    spec: ChartSpec;
    result?: QueryResult;
    error?: string;
  } | null>(null);

  const { data: catalog } = useCatalog();
  const catalogConnections = catalog?.connections.filter((c) => !c.error) ?? [];
  const connections = catalogConnections.map((c) => c.connectionName);
  // Raw SQL only makes sense against connections with a SQL dialect — mongo
  // has none, so it's excluded here (the AI tab above keeps the full list;
  // that endpoint resolves its own dialect server-side).
  const sqlConnections = catalogConnections
    .filter((c) => c.engine === "postgres" || c.engine === "mysql")
    .map((c) => c.connectionName);

  const dialectFor = (target: "single" | "federated", conns: string[]): SqlDialect => {
    if (target === "federated") return "duckdb";
    const conn = catalogConnections.find((c) => c.connectionName === conns[0]);
    return conn?.engine === "mysql" ? "mysql" : "postgres";
  };

  const generate = async () => {
    setBusy(true);
    setPreview(null);
    try {
      const res = await fetch("/api/ai/chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          connections: scope.length ? scope : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setPreview({ spec: emptySpec(), error: body.error });
      else setPreview(body);
    } catch (e) {
      setPreview({ spec: emptySpec(), error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const emptySpec = (): ChartSpec => {
    const conns = sqlConns.length ? sqlConns : sqlConnections.slice(0, 1);
    return {
      title: "New panel",
      chartType: "table",
      target: sqlTarget,
      connections: conns,
      sql,
      dialect: dialectFor(sqlTarget, conns),
      xField: null,
      yFields: [],
      seriesField: null,
      linkTo: null,
      thresholds: null,
      cacheSeconds: null,
    };
  };

  const runSql = async () => {
    setBusy(true);
    const spec =
      preview?.spec && tab === "sql"
        ? {
            ...preview.spec,
            sql,
            target: sqlTarget,
            connections: sqlConns,
            dialect: dialectFor(sqlTarget, sqlConns),
          }
        : emptySpec();
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: spec.target,
          connections: spec.connections,
          sql: substituteVariables(spec.sql, variables),
          dialect: spec.dialect,
        }),
      });
      const body = await res.json();
      if (!res.ok) setPreview({ spec, error: body.error });
      else setPreview({ spec, result: body });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview?.spec) return;
    await fetch(`/api/dashboards/${dashboardId}/panels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: preview.spec }),
    });
    qc.invalidateQueries({ queryKey: ["dashboard", dashboardId] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton
        className="w-[95vw] max-w-7xl sm:max-w-7xl p-5 max-h-[95vh] overflow-y-auto scrollbar-thin"
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as "ai" | "sql")} className="mb-4 pr-8 min-w-0">
          <TabsList className="mb-4">
            {AI_PANEL_ENABLED && <TabsTrigger value="ai">✦ Describe it</TabsTrigger>}
            <TabsTrigger value="sql">From SQL</TabsTrigger>
          </TabsList>

          <TabsContent value="ai">
            <div className="flex gap-1.5 mb-2 flex-wrap">
              <Badge
                variant={scope.length === 0 ? "default" : "outline"}
                className={scope.length === 0 ? undefined : "bg-muted"}
                render={<button onClick={() => setScope([])} />}
              >
                all connections
              </Badge>
              {connections.map((c) => {
                const active = scope.includes(c);
                return (
                  <Badge
                    key={c}
                    variant={active ? "default" : "outline"}
                    className={active ? undefined : "bg-muted"}
                    render={
                      <button onClick={() => setScope((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))} />
                    }
                  >
                    {c}
                  </Badge>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder='e.g. "revenue by month, split by order status" or "orders per customer country" (cross-DB)'
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && generate()}
              />
              <Button disabled={busy || !prompt.trim()} onClick={generate}>
                {busy ? "Generating…" : "Generate"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="sql" className="min-w-0 space-y-4">
            <div className="space-y-2">
              <div
                className="text-[11px] font-semibold tracking-wide uppercase"
                style={{ color: "var(--muted-foreground-faint)" }}
              >
                Data source
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <DataSelect
                  items={SQL_TARGET_OPTIONS}
                  value={SQL_TARGET_OPTIONS.find((o) => o.value === sqlTarget) ?? null}
                  onChange={(o) => o && setSqlTarget(o.value)}
                  size="sm"
                  className="w-32"
                />
                {sqlConnections.map((c) => {
                  const active = sqlConns.includes(c);
                  return (
                    <Badge
                      key={c}
                      variant={active ? "default" : "outline"}
                      className={active ? undefined : "bg-muted"}
                      render={
                        <button
                          onClick={() =>
                            setSqlConns((s) =>
                              sqlTarget === "single" ? [c] : s.includes(c) ? s.filter((x) => x !== c) : [...s, c],
                            )
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

            <div className="flex gap-5 items-start">
              <div className="flex-1 min-w-0 space-y-4">
                <div className="space-y-2">
                  <div
                    className="text-[11px] font-semibold tracking-wide uppercase"
                    style={{ color: "var(--muted-foreground-faint)" }}
                  >
                    Preview
                  </div>
                  <div className="panel p-3 min-w-0" style={{ background: "var(--background)" }}>
                    {preview?.error ? (
                      <div
                        className="rounded-md border px-3 py-2.5 text-[13px]"
                        style={{ color: "var(--destructive)", borderColor: "rgba(229,83,75,.4)" }}
                      >
                        {preview.error}
                        {preview.spec.sql && <SqlCode sql={preview.spec.sql} className="mt-2 text-[12px]" />}
                      </div>
                    ) : preview?.result ? (
                      <>
                        <div className="text-[13px] font-medium mb-2">{preview.spec.title}</div>
                        <ChartRenderer spec={preview.spec} result={preview.result} height={280} />
                        <details className="mt-2">
                          <summary
                            className="text-[12px] cursor-pointer"
                            style={{ color: "var(--muted-foreground-faint)" }}
                          >
                            SQL & data
                          </summary>
                          <SqlCode sql={preview.spec.sql} className="mt-1 text-[12px]" />
                          <ResultGrid result={preview.result} maxRows={20} />
                        </details>
                      </>
                    ) : (
                      <div className="text-[13px] text-center py-10" style={{ color: "var(--muted-foreground)" }}>
                        Run a preview to see your chart here.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <SqlEditor
                    placeholder={
                      sqlTarget === "federated"
                        ? "SELECT … FROM conn_a.public.t JOIN conn_b.public.u ON …"
                        : "SELECT … FROM schema.table …"
                    }
                    value={sql}
                    onChange={setSql}
                  />
                  <Button disabled={busy || !sql.trim() || sqlConns.length === 0} onClick={runSql}>
                    {busy ? "Running…" : "Run preview"}
                  </Button>
                </div>
              </div>

              <div className="w-72 shrink-0 space-y-3 sticky top-0">
                {preview?.result ? (
                  <SpecControls
                    spec={preview.spec}
                    result={preview.result}
                    onChange={(spec) => setPreview((p) => (p ? { ...p, spec } : p))}
                  />
                ) : (
                  <div
                    className="panel p-3 text-[12px] text-center py-4"
                    style={{ background: "var(--background)", color: "var(--muted-foreground-faint)" }}
                  >
                    Options appear here once a preview has run.
                  </div>
                )}
                <Button className="w-full justify-center" disabled={!preview?.result} onClick={save}>
                  Add panel
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function EditPanelModal({
  panel,
  variables,
  onClose,
  onSaved,
}: {
  panel: Panel;
  variables: DashboardVariable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [spec, setSpec] = useState<ChartSpec>(panel.spec);
  const [sql, setSql] = useState(panel.spec.sql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const run = async (s: ChartSpec) => {
    setBusy(true);
    setQueryError(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: s.target,
          connections: s.connections,
          sql: substituteVariables(s.sql, variables),
          dialect: s.dialect,
        }),
      });
      const body = await res.json();
      if (!res.ok) setQueryError(body.error ?? "query failed");
      else setResult(body);
    } finally {
      setBusy(false);
    }
  };

  // Populate the preview with the panel's current data on open, so the spec
  // controls are immediately usable without a manual "Run preview" first.
  useEffect(() => {
    run(panel.spec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sqlDirty = sql !== spec.sql;
  const runEdited = () => {
    const next = { ...spec, sql };
    setSpec(next);
    run(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/panels/${panel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: { ...spec, sql } }),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton
        className="w-[95vw] max-w-7xl sm:max-w-7xl p-5 max-h-[95vh] overflow-y-auto scrollbar-thin"
      >
        <div className="text-[14px] font-semibold mb-4 pr-8">Edit panel</div>
        <div className="flex gap-5 items-start min-w-0">
          <div className="flex-1 min-w-0 space-y-4">
            <div className="space-y-2">
              <div
                className="text-[11px] font-semibold tracking-wide uppercase"
                style={{ color: "var(--muted-foreground-faint)" }}
              >
                Preview
              </div>
              <div className="panel p-3 min-w-0" style={{ background: "var(--background)" }}>
                <div className="text-[13px] font-medium mb-2">{spec.title}</div>
                {queryError ? (
                  <div
                    className="rounded-md border px-4 py-3 text-[13px]"
                    style={{ color: "var(--destructive)", borderColor: "rgba(229,83,75,.4)" }}
                  >
                    {queryError}
                  </div>
                ) : result ? (
                  <ChartRenderer spec={spec} result={result} height={280} />
                ) : (
                  <Skeleton className="h-72 w-full" />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <SqlEditor value={sql} onChange={setSql} />
              <div className="flex items-center gap-2">
                <Button variant="secondary" disabled={busy || !sql.trim()} onClick={runEdited}>
                  {busy ? "Running…" : "Run preview"}
                </Button>
                {sqlDirty && (
                  <span className="text-[12px]" style={{ color: "var(--warning)" }}>
                    SQL changed — run preview before saving
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="w-72 shrink-0 space-y-3 sticky top-0">
            {result ? (
              <SpecControls spec={spec} result={result} onChange={setSpec} />
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
            {/* sqlDirty gate: saving un-previewed SQL could persist a spec whose
                x/y fields no longer exist in the new query's columns. */}
            <Button className="w-full justify-center" disabled={saving || busy || sqlDirty} onClick={save}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Panel | null>(null);
  // Grafana-style edit mode: viewing is the default, clean surface — panel
  // menus, drag/resize, and add-panel only exist while editing. Renaming and
  // other dashboard-level config live on the dedicated settings page, not
  // here. Driven entirely by ?edit=1 (not local state) so it's shareable and
  // survives a refresh — the list page's create flow already links straight
  // into it, and toggling "Edit" just updates the query string.
  const searchParams = useSearchParams();
  const editMode = searchParams.get("edit") === "1";
  const setEditMode = (next: boolean) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("edit", "1");
    else params.delete("edit");
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  // Live variable values as the user edits/cross-filters them — session
  // state, distinct from dash.variables (the saved defaults). Only
  // (re)seeded from the fetched dashboard the first time it loads for a
  // given id, not on every poll refetch, or a live pick would keep getting
  // stomped back to the saved default every refreshSeconds tick. Seeded from
  // the URL's ~-params first (so a shared/bookmarked link reproduces the
  // filter state it was copied with), falling back to the saved defaults.
  const [varValues, setVarValues] = useState<DashboardVariable[]>([]);
  // The dashboard's time range — unlike varValues, this is NOT a user-managed
  // variable (no Settings > Variables entry, nothing in Dashboard.variables).
  // Every dashboard just has one, like Grafana's built-in time picker, always
  // starting from the same fresh default and living only in the URL + this
  // session state.
  const [datetime, setDatetime] = useState(defaultDatetimeVariable());
  const varsInitializedFor = useRef<string | null>(null);

  const { data: dash, error } = useQuery<Dashboard>({
    queryKey: ["dashboard", id],
    queryFn: async () => {
      const res = await fetch(`/api/dashboards/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body;
    },
  });

  useEffect(() => {
    if (dash && varsInitializedFor.current !== dash.id) {
      setVarValues(applySearchParamsToVariables(dash.variables, searchParams));
      setDatetime(applySearchParamsToDatetime(defaultDatetimeVariable(), searchParams));
      varsInitializedFor.current = dash.id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dash]);

  const { data: allDashboards } = useDashboards();
  const otherDashboards = (allDashboards ?? []).filter((d) => d.id !== id);

  // Keeps the URL's ~-params in sync with the live variable values — no full
  // navigation, just the query string (scroll/panel state stays put).
  const updateVar = (name: string, patch: Partial<DashboardVariable>) =>
    setVarValues((vs) => {
      const next = vs.map((v) => (v.name === name ? ({ ...v, ...patch } as DashboardVariable) : v));
      const params = withVariablesInSearchParams(new URLSearchParams(searchParams), next);
      router.replace(`?${params.toString()}`, { scroll: false });
      return next;
    });

  // The time range gets its own plain ?from=&to= — not tied to the ~<name>
  // variable scheme, since it isn't a variable.
  const updateDatetime = (patch: Partial<DashboardVariable>) =>
    setDatetime((d) => {
      const next = { ...d, ...patch } as typeof datetime;
      const params = withDatetimeInSearchParams(new URLSearchParams(searchParams), next);
      router.replace(`?${params.toString()}`, { scroll: false });
      return next;
    });

  // Bar/pie click on a category whose field matches a variable's name — a
  // no-op if no such variable exists (see ChartRenderer's CROSS_FILTER_TYPES
  // comment for why only categorical charts wire this).
  const crossFilter = (field: string, value: string) => {
    if (varValues.some((v) => v.name === field)) updateVar(field, { value });
  };

  // Drag-select on a temporal axis chart (line/area/scatter) — Grafana's
  // "zoom the graph to set the dashboard time range."
  const handleTimeRangeSelect = (from: string, to: string) => updateDatetime({ from, to });

  const copyPanelTo = async (p: Panel, targetId: string, targetName: string) => {
    const res = await fetch(`/api/dashboards/${targetId}/panels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: p.spec }),
    });
    if (res.ok) {
      toast(`Copied "${p.spec.title}" to ${targetName}`);
      qc.invalidateQueries({ queryKey: ["dashboard", targetId] });
    }
  };

  const patch = async (fields: { name?: string; refreshSeconds?: number | null }) => {
    await fetch(`/api/dashboards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    qc.invalidateQueries({ queryKey: ["dashboard", id] });
    useDashboards.invalidate(qc);
  };

  const deletePanelWithUndo = (p: Panel, index: number) => {
    qc.setQueryData<Dashboard>(["dashboard", id], (old) =>
      old ? { ...old, panels: old.panels.filter((x) => x.id !== p.id) } : old,
    );
    const timeout = setTimeout(async () => {
      pendingPanelDeletes.delete(p.id);
      await fetch(`/api/panels/${p.id}`, { method: "DELETE" });
    }, UNDO_DELAY_MS);
    pendingPanelDeletes.set(p.id, timeout);
    toast(`Deleted panel "${p.spec.title}"`, {
      duration: UNDO_DELAY_MS,
      action: {
        label: "Undo",
        onClick: () => {
          const pending = pendingPanelDeletes.get(p.id);
          if (pending) clearTimeout(pending);
          pendingPanelDeletes.delete(p.id);
          // Never actually left the server — restore from cache, no refetch.
          qc.setQueryData<Dashboard>(["dashboard", id], (old) => {
            if (!old || old.panels.some((x) => x.id === p.id)) return old;
            const panels = [...old.panels];
            panels.splice(index, 0, p);
            return { ...old, panels };
          });
        },
      },
    });
  };

  const duplicatePanel = async (p: Panel) => {
    const res = await fetch(`/api/dashboards/${id}/panels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: { ...p.spec, title: `${p.spec.title} (copy)` } }),
    });
    qc.invalidateQueries({ queryKey: ["dashboard", id] });
    if (res.ok) toast(`Duplicated "${p.spec.title}"`);
  };

  // measureBeforeMount: without it the hook reports mounted=true with a
  // hardcoded 1280px default before the first real measurement, so the grid's
  // first paint could overflow narrower windows (horizontal scroll).
  const { width, mounted, containerRef, measureWidth } = useContainerWidth({ measureBeforeMount: true });

  // The hook's own measuring effect runs on page mount, but the container div
  // only exists once the dashboard has loaded (the !dash branch returns a
  // skeleton without it) — that effect bails on the missing node and never
  // re-runs, so trigger a measurement when the div actually mounts.
  useEffect(() => {
    if (dash) measureWidth();
  }, [dash, measureWidth]);

  // Percent-based rendering: rgl computes positions in px from the measured
  // width, but emitting left/width as % of that same width makes the ratios
  // exact — panels can't overflow the container horizontally even if the
  // measurement is momentarily stale, and the view re-scales continuously
  // with the window via CSS between measurements. Vertical stays px (fixed
  // rowHeight). Drag/resize math still uses the px width, which is fine —
  // it's settled by the time anyone is interacting.
  const positionStrategy = useMemo<NonNullable<GridLayoutProps["positionStrategy"]>>(
    () => ({
      type: "absolute",
      scale: 1,
      calcStyle: (pos) => ({
        position: "absolute",
        left: width > 0 ? `${(pos.left / width) * 100}%` : pos.left,
        width: width > 0 ? `${(pos.width / width) * 100}%` : pos.width,
        top: pos.top,
        height: pos.height,
      }),
    }),
    [width],
  );

  // GridLayout calls this after every drag/resize settles (and once on mount
  // with the unchanged layout — the diff check makes that a no-op). One
  // gesture can move several panels via collision packing, so positions are
  // persisted in bulk.
  const saveLayout = (layout: Layout) => {
    if (!dash) return;
    const byId = new Map(dash.panels.map((p) => [p.id, p]));
    const changed = layout.some((l) => {
      const p = byId.get(String(l.i));
      return p && (p.x !== l.x || p.y !== l.y || p.w !== l.w || p.h !== l.h);
    });
    if (!changed) return;
    // Optimistic cache update — the layout the user just dropped IS the new
    // truth; no refetch needed.
    qc.setQueryData<Dashboard>(["dashboard", id], (old) =>
      old
        ? {
            ...old,
            panels: old.panels.map((p) => {
              const l = layout.find((x) => String(x.i) === p.id);
              return l ? { ...p, x: l.x, y: l.y, w: l.w, h: l.h } : p;
            }),
          }
        : old,
    );
    fetch(`/api/dashboards/${id}/layout`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        panels: layout.map((l) => ({ id: String(l.i), x: l.x, y: l.y, w: l.w, h: l.h })),
      }),
    });
  };

  if (error)
    return (
      <div style={{ color: "var(--destructive)" }}>
        {(error as Error).message}
      </div>
    );
  if (!dash)
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(12, 1fr)" }}>
          {[6, 6, 12].map((w, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" style={{ gridColumn: `span ${w}` }} />
          ))}
        </div>
      </div>
    );

  return (
    <div>
      <Breadcrumbs
        className="mb-4"
        items={[{ label: "Home", link: "/" }, { label: "Dashboards", link: "/dashboards" }, { label: dash.name }]}
      />
      <div className="flex items-center gap-1 mb-5">
        <h1 className="text-lg font-semibold">{dash.name}</h1>
        <span className="flex-1" />
        <VariableValueControl variable={datetime} onChange={updateDatetime} />
        <AutoRefreshSelect
          value={(dash.refreshSeconds ?? 0) * 1000}
          onChange={(ms) => patch({ refreshSeconds: ms === 0 ? null : ms / 1000 })}
        />
        <ButtonGroup>
          <Button
            variant="secondary"
            aria-label={dash.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
            title={dash.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
            onClick={async () => {
              const next = !dash.pinned;
              qc.setQueryData<Dashboard>(["dashboard", id], (old) => (old ? { ...old, pinned: next } : old));
              await fetch(`/api/dashboards/${id}/pin`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pinned: next }),
              });
              // the sidebar's pinned list reads the ["dashboards"] cache
              useDashboards.invalidate(qc);
            }}
          >
            <Pin className={dash.pinned ? "size-3.5 fill-current" : "size-3.5"} />
          </Button>
          {/* Name, refresh defaults, and variables all live on the dedicated
              settings page (Grafana's model) rather than as inline controls
              here — this page is purely for viewing/arranging panels. */}
          <Button
            variant="secondary"
            aria-label="Dashboard settings"
            title="Dashboard settings"
            nativeButton={false}
            render={<Link href={`/dashboards/${id}/settings`} />}
          >
            <Settings2 className="size-3.5" />
          </Button>
          {editMode && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              ＋ Add panel
            </Button>
          )}
          <Button variant={editMode ? "default" : "secondary"} onClick={() => setEditMode(!editMode)}>
            {editMode ? "Done" : <Edit />}
          </Button>
        </ButtonGroup>
      </div>

      {/* Variable controls stay visible in view mode too — they're a read/filter
          affordance, not an editing one. The time range renders in the
          header instead (see above) — it's not part of this list at all. */}
      {varValues.length > 0 && (
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          {varValues.map((v) => (
            <div key={v.name} className="flex items-center gap-1.5">
              <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                {v.label || v.name}
              </span>
              <VariableValueControl variable={v} onChange={(patch) => updateVar(v.name, patch)} />
            </div>
          ))}
        </div>
      )}

      {dash.panels.length === 0 ? (
        <div className="panel px-6 py-14 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          Empty dashboard. Add a panel by describing a chart, pasting SQL, or hitting “Visualize” anywhere in Lizard.
        </div>
      ) : (
        (() => {
          const sortedPanels = [...dash.panels].sort((a, b) => a.y - b.y || a.x - b.x);
          const card = (p: Panel, i: number) => (
            <ErrorBoundary>
              <PanelCard
                panel={p}
                refreshSeconds={dash.refreshSeconds}
                variables={[...varValues, datetime]}
                editable={editMode}
                otherDashboards={otherDashboards}
                onDelete={() => deletePanelWithUndo(p, i)}
                onEdit={() => setEditing(p)}
                onDuplicate={() => duplicatePanel(p)}
                onCopyTo={(targetId, targetName) => copyPanelTo(p, targetId, targetName)}
                onCrossFilter={crossFilter}
                onTimeRangeSelect={handleTimeRangeSelect}
              />
            </ErrorBoundary>
          );
          // Below tablet width, free-form grid placement stops making sense —
          // stack panels full-width in y/x order instead (drag disabled).
          const stacked = mounted && width < 768;
          return (
            // rgl renders resize handles even with resizeConfig.enabled=false —
            // .rgl-view hides them (globals.css) while viewing.
            <div ref={containerRef} className={editMode ? undefined : "rgl-view"}>
              {!mounted ? null : stacked ? (
                <div className="space-y-3">
                  {sortedPanels.map((p, i) => (
                    <div key={p.id} style={{ height: p.h * 40 }}>
                      {card(p, i)}
                    </div>
                  ))}
                </div>
              ) : (
                <GridLayout
                  width={width}
                  layout={sortedPanels.map((p) => ({ i: p.id, x: p.x, y: p.y, w: p.w, h: p.h, minW: 3, minH: 4 }))}
                  gridConfig={{ cols: 12, rowHeight: 40, margin: [12, 12], containerPadding: [0, 0] }}
                  dragConfig={{ enabled: editMode, handle: ".drag-handle" }}
                  resizeConfig={{ enabled: editMode }}
                  positionStrategy={positionStrategy}
                  onLayoutChange={saveLayout}
                >
                  {sortedPanels.map((p, i) => (
                    <div key={p.id}>{card(p, i)}</div>
                  ))}
                </GridLayout>
              )}
            </div>
          );
        })()
      )}

      {adding && (
        <AddPanelModal dashboardId={id} variables={[...varValues, datetime]} onClose={() => setAdding(false)} />
      )}
      {editing && (
        <EditPanelModal
          panel={editing}
          variables={[...varValues, datetime]}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["dashboard", id] })}
        />
      )}
    </div>
  );
}
