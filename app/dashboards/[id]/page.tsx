"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GridLayout, useContainerWidth, type Layout, type GridLayoutProps } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { GripVertical, Pin } from "lucide-react";
import type { ChartSpec, Dashboard, Panel, QueryResult, SqlDialect } from "@/lib/types";
import { ChartRenderer } from "@/components/charts/chart-renderer";
import { SpecControls } from "@/components/charts/spec-controls";
import { ResultGrid } from "@/components/ai/result-grid";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCatalog } from "@/components/browse/use-catalog";
import { useDashboards } from "@/components/charts/use-dashboards";

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
  editable,
  onDelete,
  onEdit,
  onDuplicate,
}: {
  panel: Panel;
  refreshSeconds: number | null;
  // Dashboard edit mode: the drag handle and the panel menu (edit / duplicate
  // / delete) only exist while editing — view mode is a clean read surface.
  editable: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
}) {
  const qc = useQueryClient();
  const { spec } = panel;
  const { data, error, isLoading } = useQuery<QueryResult>({
    queryKey: ["panel", panel.id, spec.sql, spec.connections],
    queryFn: async () => {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: spec.target,
          connections: spec.connections,
          sql: spec.sql,
          dialect: spec.dialect,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "query failed");
      return body;
    },
    staleTime: 30_000,
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });

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
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="secondary" size="sm" aria-label="Panel options" />}>
              ⋮
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onEdit}>✎ Edit panel</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>⧉ Duplicate</DropdownMenuItem>
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
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading && <Skeleton className="h-full w-full" />}
        {error && (
          <p className="text-[12.5px] px-1" style={{ color: "var(--destructive)" }}>
            {(error as Error).message}
          </p>
        )}
        {/* Real pixel height of an h-row grid item is h*rowHeight + (h-1)*margin
            (40/12, see gridConfig) — minus card padding + header ≈ 76px. The
            old h*40-60 under-sized content more the taller the panel got. */}
        {data && <ChartRenderer spec={spec} result={data} height={panel.h * 52 - 76} />}
      </div>
    </div>
  );
}

// AI panel authoring ("Describe it") is parked until the dashboard work ships
// — flip this to true to launch it. The tab/content code below stays compiled
// so it can't rot in the meantime.
const AI_PANEL_ENABLED = false;

function AddPanelModal({ dashboardId, onClose }: { dashboardId: string; onClose: () => void }) {
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
          sql: spec.sql,
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
        className="w-235 max-w-[95vw] sm:max-w-[95vw] p-5 max-h-[88vh] overflow-y-auto scrollbar-thin"
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as "ai" | "sql")} className="mb-4 pr-8">
          <TabsList className="mb-4">
            {AI_PANEL_ENABLED && <TabsTrigger value="ai">✦ Describe it</TabsTrigger>}
            <TabsTrigger value="sql">From SQL</TabsTrigger>
          </TabsList>

          <TabsContent value="ai">
            <div className="flex gap-1.5 mb-2 flex-wrap">
              <button
                className="tag"
                style={scope.length === 0 ? { color: "var(--primary)" } : {}}
                onClick={() => setScope([])}
              >
                all connections
              </button>
              {connections.map((c) => (
                <button
                  key={c}
                  className="tag"
                  style={scope.includes(c) ? { color: "var(--primary)", borderColor: "var(--primary)" } : {}}
                  onClick={() => setScope((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
                >
                  {c}
                </button>
              ))}
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

          <TabsContent value="sql" className="space-y-2">
            <div className="flex gap-2 items-center flex-wrap">
              <DataSelect
                items={SQL_TARGET_OPTIONS}
                value={SQL_TARGET_OPTIONS.find((o) => o.value === sqlTarget) ?? null}
                onChange={(o) => o && setSqlTarget(o.value)}
                size="sm"
                className="w-32"
              />
              {sqlConnections.map((c) => (
                <button
                  key={c}
                  className="tag"
                  style={sqlConns.includes(c) ? { color: "var(--primary)", borderColor: "var(--primary)" } : {}}
                  onClick={() =>
                    setSqlConns((s) =>
                      sqlTarget === "single" ? [c] : s.includes(c) ? s.filter((x) => x !== c) : [...s, c],
                    )
                  }
                >
                  {c}
                </button>
              ))}
            </div>
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
          </TabsContent>
        </Tabs>

        {preview && (
          <div>
            {preview.error && (
              <div
                className="rounded-md border px-4 py-3 text-[13px] mb-3"
                style={{
                  color: "var(--destructive)",
                  borderColor: "rgba(229,83,75,.4)",
                }}
              >
                {preview.error}
                {preview.spec.sql && <SqlCode sql={preview.spec.sql} className="mt-2 text-[12px]" />}
              </div>
            )}
            {preview.result && (
              <div className="flex gap-5">
                <div className="flex-1 min-w-0 panel p-3" style={{ background: "var(--background)" }}>
                  <div className="text-[13px] font-medium mb-2">{preview.spec.title}</div>
                  <ChartRenderer spec={preview.spec} result={preview.result} height={300} />
                  <details className="mt-2">
                    <summary className="text-[12px] cursor-pointer" style={{ color: "var(--muted-foreground-faint)" }}>
                      SQL & data
                    </summary>
                    <SqlCode sql={preview.spec.sql} className="mt-1 text-[12px]" />
                    <ResultGrid result={preview.result} maxRows={20} />
                  </details>
                </div>
                <div className="w-60 shrink-0">
                  <SpecControls
                    spec={preview.spec}
                    result={preview.result}
                    onChange={(spec) => setPreview((p) => (p ? { ...p, spec } : p))}
                  />
                  <Button
                    className="w-full justify-center mt-4"

                    onClick={save}
                  >
                    Add panel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditPanelModal({ panel, onClose, onSaved }: { panel: Panel; onClose: () => void; onSaved: () => void }) {
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
        body: JSON.stringify({ target: s.target, connections: s.connections, sql: s.sql, dialect: s.dialect }),
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
        className="w-235 max-w-[95vw] sm:max-w-[95vw] p-5 max-h-[88vh] overflow-y-auto scrollbar-thin"
      >
        <div className="text-[14px] font-semibold mb-4 pr-8">Edit panel</div>
        <div className="flex gap-5">
          <div className="flex-1 min-w-0 space-y-3">
            <div className="panel p-3" style={{ background: "var(--background)" }}>
              <div className="text-[13px] font-medium mb-2">{spec.title}</div>
              {queryError ? (
                <div
                  className="rounded-md border px-4 py-3 text-[13px]"
                  style={{ color: "var(--destructive)", borderColor: "rgba(229,83,75,.4)" }}
                >
                  {queryError}
                </div>
              ) : result ? (
                <ChartRenderer spec={spec} result={result} height={300} />
              ) : (
                <Skeleton className="h-72 w-full" />
              )}
            </div>
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
          <div className="w-60 shrink-0">
            {result ? (
              <SpecControls spec={spec} result={result} onChange={setSpec} />
            ) : (
              <Skeleton className="h-56 w-full" />
            )}
            {/* sqlDirty gate: saving un-previewed SQL could persist a spec whose
                x/y fields no longer exist in the new query's columns. */}
            <Button className="w-full justify-center mt-4" disabled={saving || busy || sqlDirty} onClick={save}>
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
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Panel | null>(null);
  // Grafana-style edit mode: viewing is the default, clean surface — panel
  // menus, drag/resize, add-panel, and rename only exist while editing.
  // ?edit=1 (set by the list page's create flow) opens straight into it, so
  // a freshly created dashboard is immediately editable.
  const searchParams = useSearchParams();
  const [editMode, setEditMode] = useState(searchParams.get("edit") === "1");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  // Enter fires onKeyDown then unmounts the still-focused Input, whose
  // synthetic blur would otherwise re-trigger onBlur's commit too — guard so
  // a single Enter-driven rename doesn't PATCH twice.
  const renameCommitted = useRef(false);

  const { data: dash, error } = useQuery<Dashboard>({
    queryKey: ["dashboard", id],
    queryFn: async () => {
      const res = await fetch(`/api/dashboards/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body;
    },
  });

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
      <div className="px-8 py-10" style={{ color: "var(--destructive)" }}>
        {(error as Error).message}
      </div>
    );
  if (!dash)
    return (
      <div className="px-6 py-6 space-y-3">
        <Skeleton className="h-7 w-48" />
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(12, 1fr)" }}>
          {[6, 6, 12].map((w, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" style={{ gridColumn: `span ${w}` }} />
          ))}
        </div>
      </div>
    );

  return (
    <div className="px-6 py-6">
      <div className="flex items-center gap-3 mb-5">
        {renaming && editMode ? (
          <Input
            className="max-w-xs"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (renameCommitted.current) return;
              renameCommitted.current = true;
              patch({ name });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                renameCommitted.current = true;
                patch({ name });
                setRenaming(false);
              }
            }}
          />
        ) : editMode ? (
          <h1
            className="text-lg font-semibold cursor-pointer"
            title="Click to rename"
            role="button"
            tabIndex={0}
            onClick={() => {
              renameCommitted.current = false;
              setName(dash.name);
              setRenaming(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                renameCommitted.current = false;
                setName(dash.name);
                setRenaming(true);
              }
            }}
          >
            {dash.name}
          </h1>
        ) : (
          <h1 className="text-lg font-semibold">{dash.name}</h1>
        )}
        <span className="flex-1" />
        <AutoRefreshSelect
          value={(dash.refreshSeconds ?? 0) * 1000}
          onChange={(ms) => patch({ refreshSeconds: ms === 0 ? null : ms / 1000 })}
        />
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
        {editMode && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            ＋ Add panel
          </Button>
        )}
        <Button
          variant={editMode ? "default" : "secondary"}
          onClick={() => {
            setRenaming(false);
            setEditMode((m) => !m);
          }}
        >
          {editMode ? "Done" : "✎ Edit"}
        </Button>
      </div>

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
                editable={editMode}
                onDelete={() => deletePanelWithUndo(p, i)}
                onEdit={() => setEditing(p)}
                onDuplicate={() => duplicatePanel(p)}
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

      {adding && <AddPanelModal dashboardId={id} onClose={() => setAdding(false)} />}
      {editing && (
        <EditPanelModal
          panel={editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["dashboard", id] })}
        />
      )}
    </div>
  );
}
