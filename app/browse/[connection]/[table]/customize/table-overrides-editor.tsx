"use client";

// Left column of the customize page: table-level overrides (label, display
// column, visibility, pretend primary key) and per-column overrides (label,
// widget, order, hidden/readonly/redacted, enum options + per-value
// labels). Saved under `saveSchema`, which the page resolves from its
// source-scope tabs (a concrete schema, or a glob pattern for multi-tenant).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { resolveColumnOverrides } from "@/lib/introspect/overrides";
import { selectOptions } from "@/lib/introspect/heuristics";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Chip } from "@/components/ui/chip";
import { ColumnsSelect } from "@/components/browse/columns-select";
import { WidgetSelect, type WidgetOption } from "@/components/browse/widget-select";
import type { TableMeta } from "@/components/browse/useTableMeta";
import type { ColumnOverride } from "@/lib/types";
import { widgets, widgetIcons } from "@/lib/data/widgets";
import { WidgetsHelpDialog } from "@/components/browse/widgets-help-dialog";



const WIDGETS: WidgetOption[] = widgets.map((x, i) => {
  const Icon = widgetIcons[x];
  if (i === 0) {
    return { value: "", label: x, icon: Icon ? <Icon /> : null };
  }
  return { value: x, label: x, icon: Icon ? <Icon /> : null };
});

// Chip list of a column's allowed values, each with an optional display
// label (e.g. "m" -> "Male"). `editable` gates whether values themselves can
// be added/removed here — a native enum/check-IN constraint's value set is
// DB-enforced (the DB rejects an added value on save, and removing one here
// wouldn't stop it appearing in existing rows), so only its labels are
// editable. A custom (non-native) column's option set has no such
// constraint, so both are editable.
function OptionsEditor({
  options,
  optionLabels,
  editable,
  onChange,
}: {
  options: string[];
  optionLabels: Record<string, string>;
  editable: boolean;
  onChange: (options: string[], optionLabels: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-2">
      {options.length > 0 && (
        <div className="space-y-1.5">
          {options.map((o) => (
            <div key={o} className="flex items-center gap-2">
              <span className="code text-[12px] w-28 truncate" title={o}>
                {o}
              </span>
              <Input
                className="flex-1"
                placeholder="label"
                value={optionLabels[o] ?? ""}
                onChange={(e) => {
                  const next = { ...optionLabels };
                  if (e.target.value) next[o] = e.target.value;
                  else delete next[o];
                  onChange(options, next);
                }}
              />
              {editable && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    const nextLabels = { ...optionLabels };
                    delete nextLabels[o];
                    onChange(
                      options.filter((x) => x !== o),
                      nextLabels,
                    );
                  }}
                >
                  ✕
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {editable && (
        <Input
          placeholder="add option value, Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              if (!options.includes(draft.trim())) onChange([...options, draft.trim()], optionLabels);
              setDraft("");
            }
          }}
        />
      )}
    </div>
  );
}

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
  // meta.hasRealKey reflects introspection, unaffected by any pretend-PK
  // override already overlaid onto meta.table.primaryKey — using
  // meta.table.primaryKey.length here instead would make the picker
  // disappear the moment a pretend PK is saved (it'd look "real" too).
  const hasRealKey = meta.hasRealKey;
  const [pkCols, setPkCols] = useState<string[]>(meta.tableOverride?.primaryKey ?? []);
  const [cols, setCols] = useState(
    meta.columns.map((cm, i) => ({
      name: cm.col.name,
      label: findOv(cm.col.name)?.label ?? "",
      widget: findOv(cm.col.name)?.widget ?? "",
      hidden: cm.hidden,
      readonly: findOv(cm.col.name)?.readonly ?? false,
      redacted: findOv(cm.col.name)?.redacted ?? cm.redacted,
      // fixed by the DB schema — value set can't be added to/removed here
      nativeOptions: selectOptions(meta.table, cm.col),
      // only meaningful (and only ever saved) when nativeOptions is null
      customOptions: findOv(cm.col.name)?.options ?? [],
      optionLabels: findOv(cm.col.name)?.optionLabels ?? {},
      order: i,
    })),
  );
  const [saved, setSaved] = useState(false);
  const [optionsDialogFor, setOptionsDialogFor] = useState<string | null>(null);

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
          primaryKey: !hasRealKey && pkCols.length ? pkCols : null,
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
            options: c.nativeOptions ? null : c.customOptions.length ? c.customOptions : null,
            optionLabels: Object.keys(c.optionLabels).length ? c.optionLabels : null,
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

  const dialogCol = cols.find((c) => c.name === optionsDialogFor) ?? null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="label">Table label</label>
          <Input value={tableLabel} placeholder={meta.label} onChange={(e) => setTableLabel(e.target.value)} />
        </div>
        <div>
          <label className="label">Display column (used for FK labels)</label>
          <ColumnsSelect
            items={meta.table.columns}
            value={meta.table.columns.find((c) => c.name === displayCol) ?? null}
            onChange={(col) => setDisplayCol(col?.name ?? "")}
            placeholder={`auto (${meta.displayColumn})`}
            className="w-full"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-[13px] mb-6" style={{ color: "var(--muted-foreground)" }}>
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
        Hide this table from the sidebar
      </label>

      {!hasRealKey && (
        <div className="mb-6">
          <label className="label">
            Primary key — this table has no declared primary key or unique constraint. Pick one or more columns to
            make row editing/deleting possible.
          </label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {meta.table.columns.map((c) => {
              const on = pkCols.includes(c.name);
              return (
                <Chip
                  key={c.name}
                  active={on}
                  title={on ? `Remove ${c.name} from the primary key` : `Add ${c.name} to the primary key`}
                  onClick={() => setPkCols((s) => (on ? s.filter((x) => x !== c.name) : [...s, c.name]))}
                >
                  {c.name}
                </Chip>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 mb-2">
        <div
          className="text-[12px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted-foreground-faint)" }}
        >
          Columns
        </div>
        <WidgetsHelpDialog />
      </div>
      <div className="space-y-2 mb-6">
        {cols.map((c, i) => {
          // "col type is enum": either natively (a real enum/check-IN
          // constraint) or because the widget dropdown was set to "select".
          const options = c.nativeOptions ?? c.customOptions;
          const isEnum = c.nativeOptions !== null || c.widget === "select" || c.customOptions.length > 0;
          return (
            <Card key={c.name} size="sm" className="px-3 py-2.5 gap-2">
              <div className="flex items-center gap-2">
                <span className="code text-[12px] flex-1 truncate" title={c.name}>
                  {c.name}
                </span>
                <Input
                  className="flex-2"
                  placeholder="Label"
                  value={c.label}
                  onChange={(e) => setCols((s) => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <WidgetSelect
                  items={WIDGETS}
                  value={WIDGETS.find((w) => w.value === c.widget) ?? WIDGETS[0]}
                  onChange={(w) => setCols((s) => s.map((x, j) => (j === i ? { ...x, widget: w.value } : x)))}
                  className="flex-1"
                />
                <Button variant="secondary" size="icon-sm" onClick={() => move(i, -1)}>
                  ↑
                </Button>
                <Button variant="secondary" size="icon-sm" onClick={() => move(i, 1)}>
                  ↓
                </Button>
              </div>
              <div className="flex items-center gap-4 text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={c.hidden}
                    onChange={(e) =>
                      setCols((s) => s.map((x, j) => (j === i ? { ...x, hidden: e.target.checked } : x)))
                    }
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
                {isEnum && (
                  <button
                    type="button"
                    className="hoverable"
                    style={{ color: "var(--primary)" }}
                    onClick={() => setOptionsDialogFor(c.name)}
                  >
                    Options{options.length ? ` (${options.length})` : ""}…
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Button disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : saved ? "Saved ✓" : "Save customizations"}
      </Button>

      <Dialog open={!!dialogCol} onOpenChange={(o) => !o && setOptionsDialogFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogCol?.name} — options &amp; labels</DialogTitle>
          </DialogHeader>
          {dialogCol && (
            <OptionsEditor
              options={dialogCol.nativeOptions ?? dialogCol.customOptions}
              optionLabels={dialogCol.optionLabels}
              editable={dialogCol.nativeOptions === null}
              onChange={(options, optionLabels) =>
                setCols((s) =>
                  s.map((x) =>
                    x.name === dialogCol.name
                      ? { ...x, customOptions: x.nativeOptions ? x.customOptions : options, optionLabels }
                      : x,
                  ),
                )
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
