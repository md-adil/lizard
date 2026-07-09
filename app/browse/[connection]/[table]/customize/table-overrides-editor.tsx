"use client";

// Left column of the customize page: table-level overrides (label, display
// column, visibility) and per-column overrides (label, widget, order,
// hidden/readonly). Saved under `saveSchema`, which the page resolves from its
// source-scope tabs (a concrete schema, or a glob pattern for multi-tenant).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { resolveColumnOverrides } from "@/lib/introspect/overrides";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TableMeta } from "@/components/browse/useTableMeta";
import type { ColumnOverride } from "@/lib/types";

const WIDGETS = [
  "",
  "text",
  "textarea",
  "number",
  "toggle",
  "date",
  "datetime",
  "select",
  "json",
  "reference",
  "array",
  "range",
  "network",
  "interval",
  "uuid",
  "bytea",
];

export function TableOverridesEditor({
  meta,
  columnOverrides,
  saveSchema,
  onSaved,
}: {
  meta: TableMeta;
  columnOverrides: ColumnOverride[];
  // Where to write overrides: the table's own schema, or a glob pattern when
  // the page is scoped to one. Reads always resolve against meta.resolvedSchema.
  saveSchema: string;
  onSaved: () => void;
}) {
  const colOv = resolveColumnOverrides(columnOverrides, meta.connectionId, meta.resolvedSchema, meta.table.name);
  const findOv = (name: string) => colOv.find((o) => o.column === name);

  const [tableLabel, setTableLabel] = useState(meta.tableOverride?.label ?? "");
  const [displayCol, setDisplayCol] = useState(meta.tableOverride?.displayColumn ?? "");
  const [hidden, setHidden] = useState(meta.tableOverride?.hidden ?? false);
  const [cols, setCols] = useState(
    meta.columns.map((cm, i) => ({
      name: cm.col.name,
      label: findOv(cm.col.name)?.label ?? "",
      widget: findOv(cm.col.name)?.widget ?? "",
      hidden: cm.hidden,
      readonly: findOv(cm.col.name)?.readonly ?? false,
      redacted: findOv(cm.col.name)?.redacted ?? cm.redacted,
      order: i,
    })),
  );
  const [saved, setSaved] = useState(false);

  function move(i: number, dir: -1 | 1) {
    setCols((s) => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((c, idx) => ({ ...c, order: idx }));
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      await fetch("/api/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "table",
          connectionId: meta.connectionId,
          schema: saveSchema,
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
            schema: saveSchema,
            table: meta.table.name,
            column: c.name,
            label: c.label || null,
            widget: c.widget || null,
            hidden: c.hidden,
            readonly: c.readonly,
            redacted: c.redacted,
            sortOrder: c.order,
            help: null,
          }),
        });
      }
    },
    onSuccess: () => {
      onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="label">Table label</label>
          <input
            className="input"
            value={tableLabel}
            placeholder={meta.label}
            onChange={(e) => setTableLabel(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Display column (used for FK labels)</label>
          <select className="input" value={displayCol} onChange={(e) => setDisplayCol(e.target.value)}>
            <option value="">auto ({meta.displayColumn})</option>
            {meta.table.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[13px] mb-6" style={{ color: "var(--muted-foreground)" }}>
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
        Hide this table from the sidebar
      </label>

      <div
        className="text-[12px] font-semibold uppercase tracking-wider mb-2"
        style={{ color: "var(--muted-foreground-faint)" }}
      >
        Columns
      </div>
      <div className="space-y-2 mb-6">
        {cols.map((c, i) => (
          <Card key={c.name} size="sm" className="px-3 py-2.5 gap-2">
            <div className="flex items-center gap-2">
              <span className="code text-[12px] flex-1 truncate" title={c.name}>
                {c.name}
              </span>
              <input
                className="input flex-2"
                style={{ padding: "3px 8px", fontSize: 12 }}
                placeholder="Label"
                value={c.label}
                onChange={(e) => setCols((s) => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <select
                className="input flex-1"
                style={{ padding: "3px 6px", fontSize: 12 }}
                value={c.widget}
                onChange={(e) => setCols((s) => s.map((x, j) => (j === i ? { ...x, widget: e.target.value } : x)))}
              >
                {WIDGETS.map((w) => (
                  <option key={w} value={w}>
                    {w || "auto"}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="icon-sm" onClick={() => move(i, -1)}>
                ↑
              </Button>
              <Button variant="outline" size="icon-sm" onClick={() => move(i, 1)}>
                ↓
              </Button>
            </div>
            <div className="flex gap-4 text-[12px]" style={{ color: "var(--muted-foreground)" }}>
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
                  onChange={(e) =>
                    setCols((s) => s.map((x, j) => (j === i ? { ...x, readonly: e.target.checked } : x)))
                  }
                />
                readonly
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={c.redacted}
                  onChange={(e) =>
                    setCols((s) => s.map((x, j) => (j === i ? { ...x, redacted: e.target.checked } : x)))
                  }
                />
                redacted
              </label>
            </div>
          </Card>
        ))}
      </div>

      <Button disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : saved ? "Saved ✓" : "Save customizations"}
      </Button>
    </div>
  );
}
