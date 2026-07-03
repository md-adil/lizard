"use client";

// "Polish the auto UI" drawer (Phase 3): table/column overrides + virtual
// relationships across connections. Everything is optional refinement.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TableMeta, CatalogResponse } from "./useTableMeta";

const WIDGETS = ["", "text", "textarea", "number", "toggle", "date", "datetime", "select", "json", "reference", "readonly"];

export function CustomizePanel({
  meta,
  catalog,
  onClose,
}: {
  meta: TableMeta;
  catalog: CatalogResponse;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tableLabel, setTableLabel] = useState(meta.tableOverride?.label ?? "");
  const [displayCol, setDisplayCol] = useState(meta.tableOverride?.displayColumn ?? "");
  const [hidden, setHidden] = useState(meta.tableOverride?.hidden ?? false);
  const [cols, setCols] = useState(
    meta.columns.map((cm, i) => ({
      name: cm.col.name,
      label: catalog.columnOverrides.find(
        (o) => o.connectionId === meta.connectionId && o.schema === meta.schema && o.table === meta.table.name && o.column === cm.col.name
      )?.label ?? "",
      widget:
        catalog.columnOverrides.find(
          (o) => o.connectionId === meta.connectionId && o.schema === meta.schema && o.table === meta.table.name && o.column === cm.col.name
        )?.widget ?? "",
      hidden: cm.hidden,
      readonly:
        catalog.columnOverrides.find(
          (o) => o.connectionId === meta.connectionId && o.schema === meta.schema && o.table === meta.table.name && o.column === cm.col.name
        )?.readonly ?? false,
      order: i,
    }))
  );
  const [vfk, setVfk] = useState({ fromColumn: "", toConnection: "", toSchema: "", toTable: "", toColumn: "" });
  const [saved, setSaved] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["rows", meta.connection, meta.schema, meta.table.name] });
  };

  const save = useMutation({
    mutationFn: async () => {
      await fetch("/api/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "table",
          connectionId: meta.connectionId,
          schema: meta.schema,
          table: meta.table.name,
          hidden,
          displayColumn: displayCol || null,
          label: tableLabel || null,
        }),
      });
      for (const c of cols) {
        await fetch("/api/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "column",
            connectionId: meta.connectionId,
            schema: meta.schema,
            table: meta.table.name,
            column: c.name,
            label: c.label || null,
            widget: c.widget || null,
            hidden: c.hidden,
            readonly: c.readonly,
            sortOrder: c.order,
            help: null,
          }),
        });
      }
    },
    onSuccess: () => {
      invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });

  const addVfk = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/virtual-fks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromConnection: meta.connection,
          fromSchema: meta.schema,
          fromTable: meta.table.name,
          fromColumn: vfk.fromColumn,
          toConnection: vfk.toConnection,
          toSchema: vfk.toSchema,
          toTable: vfk.toTable,
          toColumn: vfk.toColumn,
          label: null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
    },
    onSuccess: () => {
      setVfk({ fromColumn: "", toConnection: "", toSchema: "", toTable: "", toColumn: "" });
      invalidate();
    },
  });

  const removeVfk = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/virtual-fks/${id}`, { method: "DELETE" });
    },
    onSuccess: invalidate,
  });

  const move = (i: number, dir: -1 | 1) => {
    setCols((s) => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((c, idx) => ({ ...c, order: idx }));
    });
  };

  const targetConn = catalog.connections.find((c) => c.connectionName === vfk.toConnection);
  const targetSchema = targetConn?.schemas.find((s) => s.name === vfk.toSchema);
  const targetTable = targetSchema?.tables.find((t) => t.name === vfk.toTable);

  return (
    <>
      <div className="fixed inset-0 z-30" style={{ background: "var(--overlay)" }} onClick={onClose} />
      <div
        className="fixed right-0 top-0 bottom-0 z-40 w-[520px] max-w-full overflow-y-auto scrollbar-thin border-l p-6"
        style={{ background: "var(--bg-panel)" }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-semibold">Customize “{meta.label}”</h2>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="label">Table label</label>
            <input className="input" value={tableLabel} placeholder={meta.label} onChange={(e) => setTableLabel(e.target.value)} />
          </div>
          <div>
            <label className="label">Display column (used for FK labels)</label>
            <select className="input" value={displayCol} onChange={(e) => setDisplayCol(e.target.value)}>
              <option value="">auto ({meta.displayColumn})</option>
              {meta.table.columns.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px] mb-5" style={{ color: "var(--text-dim)" }}>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Hide this table from the sidebar
        </label>

        <div className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-faint)" }}>
          Columns
        </div>
        <div className="space-y-2 mb-5">
          {cols.map((c, i) => (
            <div key={c.name} className="panel px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="code text-[12px] w-32 truncate" title={c.name}>{c.name}</span>
                <input
                  className="input flex-1"
                  style={{ padding: "3px 8px", fontSize: 12 }}
                  placeholder="Label"
                  value={c.label}
                  onChange={(e) => setCols((s) => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <select
                  className="input w-24"
                  style={{ padding: "3px 6px", fontSize: 12 }}
                  value={c.widget}
                  onChange={(e) => setCols((s) => s.map((x, j) => (j === i ? { ...x, widget: e.target.value } : x)))}
                >
                  {WIDGETS.map((w) => (
                    <option key={w} value={w}>{w || "auto"}</option>
                  ))}
                </select>
                <button className="btn btn-sm" onClick={() => move(i, -1)}>↑</button>
                <button className="btn btn-sm" onClick={() => move(i, 1)}>↓</button>
              </div>
              <div className="flex gap-4 mt-1.5 text-[12px]" style={{ color: "var(--text-dim)" }}>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={c.hidden}
                    onChange={(e) => setCols((s) => s.map((x, j) => (j === i ? { ...x, hidden: e.target.checked } : x)))}
                  />
                  hidden
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={c.readonly}
                    onChange={(e) => setCols((s) => s.map((x, j) => (j === i ? { ...x, readonly: e.target.checked } : x)))}
                  />
                  readonly
                </label>
              </div>
            </div>
          ))}
        </div>

        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : saved ? "Saved ✓" : "Save customizations"}
        </button>

        <div className="text-[12px] font-semibold uppercase tracking-wider mt-8 mb-2" style={{ color: "var(--text-faint)" }}>
          Virtual relationships (cross-database links)
        </div>
        <p className="text-[12.5px] mb-3" style={{ color: "var(--text-dim)" }}>
          Link a column here to a table in another service. Powers reference labels/pickers and tells the AI how to join across databases.
        </p>
        {meta.virtualFks.map((v) => (
          <div key={v.id} className="panel px-3 py-2 mb-2 flex items-center justify-between text-[12.5px]">
            <span className="code">
              {v.fromColumn} → {v.toConnection}.{v.toSchema}.{v.toTable}.{v.toColumn}
            </span>
            <button className="btn btn-sm btn-danger" onClick={() => removeVfk.mutate(v.id)}>✕</button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <select className="input" value={vfk.fromColumn} onChange={(e) => setVfk((s) => ({ ...s, fromColumn: e.target.value }))}>
            <option value="">— column here —</option>
            {meta.table.columns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <select className="input" value={vfk.toConnection} onChange={(e) => setVfk({ ...vfk, toConnection: e.target.value, toSchema: "", toTable: "", toColumn: "" })}>
            <option value="">— target connection —</option>
            {catalog.connections.map((c) => (
              <option key={c.connectionName} value={c.connectionName}>{c.connectionName}</option>
            ))}
          </select>
          <select className="input" value={vfk.toSchema} disabled={!targetConn} onChange={(e) => setVfk({ ...vfk, toSchema: e.target.value, toTable: "", toColumn: "" })}>
            <option value="">— schema —</option>
            {targetConn?.schemas.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          <select className="input" value={vfk.toTable} disabled={!targetSchema} onChange={(e) => setVfk({ ...vfk, toTable: e.target.value, toColumn: "" })}>
            <option value="">— table —</option>
            {targetSchema?.tables.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
          <select className="input" value={vfk.toColumn} disabled={!targetTable} onChange={(e) => setVfk({ ...vfk, toColumn: e.target.value })}>
            <option value="">— column —</option>
            {targetTable?.columns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <button
            className="btn"
            disabled={!vfk.fromColumn || !vfk.toColumn || addVfk.isPending}
            onClick={() => addVfk.mutate()}
          >
            + Link
          </button>
        </div>
      </div>
    </>
  );
}
