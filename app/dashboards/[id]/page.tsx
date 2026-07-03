"use client";

// Dashboard view (Phase 6): a 12-column grid of chart panels; each panel runs
// its own guarded query and may span different connections.
import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChartSpec, Dashboard, Panel, QueryResult } from "@/lib/types";
import { ChartRenderer } from "@/components/charts/ChartRenderer";
import { SpecControls } from "@/components/charts/SpecControls";
import { ResultGrid } from "@/components/ai/ResultGrid";

const REFRESH_OPTIONS = [
  { label: "off", value: null },
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
];

function PanelCard({
  panel,
  refreshSeconds,
  onDelete,
  onResize,
}: {
  panel: Panel;
  refreshSeconds: number | null;
  onDelete: () => void;
  onResize: (w: number, h: number) => void;
}) {
  const { spec } = panel;
  const { data, error, isLoading } = useQuery<QueryResult>({
    queryKey: ["panel", panel.id, spec.sql, spec.connections],
    queryFn: async () => {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: spec.target, connections: spec.connections, sql: spec.sql, dialect: spec.dialect }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "query failed");
      return body;
    },
    staleTime: 30_000,
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });
  const [menu, setMenu] = useState(false);

  return (
    <div
      className="panel p-3 flex flex-col min-w-0"
      style={{ gridColumn: `span ${panel.w}`, gridRow: `span ${panel.h}` }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[13px] font-medium truncate">{spec.title}</span>
        {spec.connections.map((c) => (
          <span key={c} className="tag" style={{ fontSize: 10 }}>
            {c}
          </span>
        ))}
        <span className="flex-1" />
        <div className="relative">
          <button className="btn btn-sm" onClick={() => setMenu((m) => !m)}>
            ⋮
          </button>
          {menu && (
            <div
              className="absolute right-0 z-20 mt-1 w-44 rounded-md border p-2 space-y-1"
              style={{ background: "var(--bg-raised)", borderColor: "var(--border-strong)" }}
            >
              <div className="flex items-center gap-1 text-[12px]" style={{ color: "var(--text-dim)" }}>
                w
                <button className="btn btn-sm" onClick={() => onResize(Math.max(3, panel.w - 1), panel.h)}>−</button>
                <button className="btn btn-sm" onClick={() => onResize(Math.min(12, panel.w + 1), panel.h)}>＋</button>
                h
                <button className="btn btn-sm" onClick={() => onResize(panel.w, Math.max(4, panel.h - 1))}>−</button>
                <button className="btn btn-sm" onClick={() => onResize(panel.w, Math.min(20, panel.h + 1))}>＋</button>
              </div>
              <button className="btn btn-sm btn-danger w-full justify-center" onClick={onDelete}>
                Delete panel
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {isLoading && <div className="h-full rounded animate-pulse" style={{ background: "var(--bg-raised)" }} />}
        {error && (
          <p className="text-[12.5px] px-1" style={{ color: "var(--red)" }}>
            {(error as Error).message}
          </p>
        )}
        {data && <ChartRenderer spec={spec} result={data} height={panel.h * 40 - 60} />}
      </div>
    </div>
  );
}

function AddPanelModal({ dashboardId, onClose }: { dashboardId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"ai" | "sql">("ai");
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [sql, setSql] = useState("");
  const [sqlTarget, setSqlTarget] = useState<"single" | "federated">("single");
  const [sqlConns, setSqlConns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ spec: ChartSpec; result?: QueryResult; error?: string } | null>(null);

  const { data: catalog } = useQuery<{ connections: { connectionName: string; error?: string }[] }>({
    queryKey: ["catalog"],
    queryFn: async () => (await fetch("/api/catalog")).json(),
  });
  const connections = catalog?.connections.filter((c) => !c.error).map((c) => c.connectionName) ?? [];

  const generate = async () => {
    setBusy(true);
    setPreview(null);
    try {
      const res = await fetch("/api/ai/chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, connections: scope.length ? scope : undefined }),
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

  const emptySpec = (): ChartSpec => ({
    title: "New panel",
    chartType: "table",
    target: sqlTarget,
    connections: sqlConns.length ? sqlConns : connections.slice(0, 1),
    sql,
    dialect: sqlTarget === "federated" ? "duckdb" : "postgres",
    xField: null,
    yFields: [],
    seriesField: null,
  });

  const runSql = async () => {
    setBusy(true);
    const spec = preview?.spec && tab === "sql" ? { ...preview.spec, sql, target: sqlTarget, connections: sqlConns, dialect: sqlTarget === "federated" ? ("duckdb" as const) : ("postgres" as const) } : emptySpec();
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: spec.target, connections: spec.connections, sql: spec.sql, dialect: spec.dialect }),
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
    <>
      <div className="fixed inset-0 z-40" style={{ background: "var(--overlay)" }} onClick={onClose} />
      <div className="fixed z-50 inset-x-0 top-[5vh] mx-auto w-[940px] max-w-[95vw] panel p-5 max-h-[88vh] overflow-y-auto scrollbar-thin" style={{ background: "var(--bg-panel)" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1">
            <button className="tag" style={tab === "ai" ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}} onClick={() => setTab("ai")}>
              ✦ Describe it
            </button>
            <button className="tag" style={tab === "sql" ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}} onClick={() => setTab("sql")}>
              From SQL
            </button>
          </div>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        {tab === "ai" ? (
          <div className="mb-4">
            <div className="flex gap-1.5 mb-2 flex-wrap">
              <button className="tag" style={scope.length === 0 ? { color: "var(--accent)" } : {}} onClick={() => setScope([])}>
                all connections
              </button>
              {connections.map((c) => (
                <button
                  key={c}
                  className="tag"
                  style={scope.includes(c) ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}}
                  onClick={() => setScope((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className="input"
                placeholder='e.g. "revenue by month, split by order status" or "orders per customer country" (cross-DB)'
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && generate()}
              />
              <button className="btn btn-primary" disabled={busy || !prompt.trim()} onClick={generate}>
                {busy ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-4 space-y-2">
            <div className="flex gap-2 items-center flex-wrap">
              <select
                className="input w-32"
                value={sqlTarget}
                onChange={(e) => setSqlTarget(e.target.value as "single" | "federated")}
              >
                <option value="single">single</option>
                <option value="federated">federated</option>
              </select>
              {connections.map((c) => (
                <button
                  key={c}
                  className="tag"
                  style={sqlConns.includes(c) ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}}
                  onClick={() =>
                    setSqlConns((s) =>
                      sqlTarget === "single" ? [c] : s.includes(c) ? s.filter((x) => x !== c) : [...s, c]
                    )
                  }
                >
                  {c}
                </button>
              ))}
            </div>
            <textarea
              className="input code"
              rows={4}
              placeholder={sqlTarget === "federated" ? "SELECT … FROM conn_a.public.t JOIN conn_b.public.u ON …" : "SELECT … FROM schema.table …"}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
            />
            <button className="btn btn-primary" disabled={busy || !sql.trim() || sqlConns.length === 0} onClick={runSql}>
              {busy ? "Running…" : "Run preview"}
            </button>
          </div>
        )}

        {preview && (
          <div>
            {preview.error && (
              <div className="rounded-md border px-4 py-3 text-[13px] mb-3" style={{ color: "var(--red)", borderColor: "rgba(229,83,75,.4)" }}>
                {preview.error}
                {preview.spec.sql && (
                  <pre className="code mt-2 whitespace-pre-wrap" style={{ color: "var(--text-dim)" }}>{preview.spec.sql}</pre>
                )}
              </div>
            )}
            {preview.result && (
              <div className="flex gap-5">
                <div className="flex-1 min-w-0 panel p-3" style={{ background: "var(--bg)" }}>
                  <div className="text-[13px] font-medium mb-2">{preview.spec.title}</div>
                  <ChartRenderer spec={preview.spec} result={preview.result} height={300} />
                  <details className="mt-2">
                    <summary className="text-[12px] cursor-pointer" style={{ color: "var(--text-faint)" }}>
                      SQL & data
                    </summary>
                    <pre className="code text-[12px] whitespace-pre-wrap mt-1" style={{ color: "var(--text-dim)" }}>
                      {preview.spec.sql}
                    </pre>
                    <ResultGrid result={preview.result} maxRows={20} />
                  </details>
                </div>
                <div className="w-60 shrink-0">
                  <SpecControls
                    spec={preview.spec}
                    result={preview.result}
                    onChange={(spec) => setPreview((p) => (p ? { ...p, spec } : p))}
                  />
                  <button className="btn btn-primary w-full justify-center mt-4" onClick={save}>
                    Add panel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");

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
    qc.invalidateQueries({ queryKey: ["dashboards"] });
  };

  if (error) return <div className="px-8 py-10" style={{ color: "var(--red)" }}>{(error as Error).message}</div>;
  if (!dash) return <div className="px-8 py-10" style={{ color: "var(--text-dim)" }}>Loading…</div>;

  return (
    <div className="px-6 py-6">
      <div className="flex items-center gap-3 mb-5">
        {renaming ? (
          <input
            className="input max-w-xs"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              patch({ name });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                patch({ name });
                setRenaming(false);
              }
            }}
          />
        ) : (
          <h1
            className="text-lg font-semibold cursor-pointer"
            title="Click to rename"
            onClick={() => {
              setName(dash.name);
              setRenaming(true);
            }}
          >
            {dash.name}
          </h1>
        )}
        <span className="flex-1" />
        <div className="flex items-center gap-1 text-[12px]" style={{ color: "var(--text-dim)" }}>
          refresh:
          {REFRESH_OPTIONS.map((o) => (
            <button
              key={o.label}
              className="tag"
              style={dash.refreshSeconds === o.value ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}}
              onClick={() => patch({ refreshSeconds: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          ＋ Add panel
        </button>
      </div>

      {dash.panels.length === 0 ? (
        <div className="panel px-6 py-14 text-center text-[13px]" style={{ color: "var(--text-dim)" }}>
          Empty dashboard. Add a panel by describing a chart, pasting SQL, or hitting “Visualize” anywhere in Lizard.
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(12, 1fr)", gridAutoRows: 40 }}>
          {[...dash.panels]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((p) => (
              <PanelCard
                key={p.id}
                panel={p}
                refreshSeconds={dash.refreshSeconds}
                onDelete={async () => {
                  await fetch(`/api/panels/${p.id}`, { method: "DELETE" });
                  qc.invalidateQueries({ queryKey: ["dashboard", id] });
                }}
                onResize={async (w, h) => {
                  await fetch(`/api/panels/${p.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ w, h }),
                  });
                  qc.invalidateQueries({ queryKey: ["dashboard", id] });
                }}
              />
            ))}
        </div>
      )}

      {adding && <AddPanelModal dashboardId={id} onClose={() => setAdding(false)} />}
    </div>
  );
}
