"use client";

// Left column of the customize page: table-level overrides (label, display
// column, visibility, pretend primary key) and per-column overrides (label,
// widget, order, hidden/readonly/redacted, enum options + per-value
// labels). Saved under `saveSchema`, which the page resolves from its
// source-scope tabs (a concrete schema, or a glob pattern for multi-tenant).
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { resolveColumnOverrides, resolveTableOverride } from "@/lib/introspect/overrides";
import { selectOptions } from "@/lib/introspect/heuristics";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Chip } from "@/components/ui/chip";
import { TabsContent } from "@/components/ui/tabs";
import { ColumnsSelect } from "@/components/browse/columns-select";
import { WidgetSelect, type WidgetOption } from "@/components/browse/widget-select";
import type { TableMeta } from "@/components/browse/useTableMeta";
import type { ColumnOverride, TableOverride } from "@/lib/types";
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

// Rendered at the bottom of both the Settings and Columns tabs (not
// Relationships, which saves each add/delete immediately) — same `save`
// mutation either way, so clicking from whichever tab is active submits
// everything (table + column overrides) together.
function SaveButton({ save, saved }: { save: { isPending: boolean; mutate: () => void }; saved: boolean }) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <Button disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : saved ? "Saved ✓" : "Save customizations"}
      </Button>
    </div>
  );
}

export function TableOverridesEditor({
  meta,
  tableOverrides,
  columnOverrides,
  scope,
  saveSchema,
  onSaved,
}: {
  meta: TableMeta;
  tableOverrides: TableOverride[];
  columnOverrides: ColumnOverride[];
  // "schema" vs "pattern" toggle only — NOT the live pattern text. Used
  // purely to trigger the resync effect below on an actual scope switch;
  // saveSchema itself changes on every keystroke while typing a pattern, so
  // resyncing off *that* would wipe whatever the user just typed into the
  // other fields mid-keystroke (see the effect for the full story).
  scope: "schema" | "pattern";
  // Where to write AND read overrides for this editor's own form fields: the
  // table's own schema, or a glob pattern when the page is scoped to one.
  // Deliberately NOT meta.resolvedSchema — that's whatever schema the page
  // happens to be *viewing*, which in pattern scope can differ from the
  // pattern string itself (and may have its own, unrelated exact override).
  saveSchema: string;
  onSaved: () => void;
}) {
  const tableOv = resolveTableOverride(tableOverrides, meta.connectionId, saveSchema, meta.table.name);
  const colOv = resolveColumnOverrides(columnOverrides, meta.connectionId, saveSchema, meta.table.name);
  const findOv = (name: string) => colOv.find((o) => o.column === name);

  const columnsInit = () =>
    meta.columns.map((cm, i) => ({
      name: cm.col.name,
      label: findOv(cm.col.name)?.label ?? "",
      widget: findOv(cm.col.name)?.widget ?? "",
      hidden: findOv(cm.col.name)?.hidden ?? false,
      hiddenInGrid: findOv(cm.col.name)?.hiddenInGrid ?? false,
      readonly: findOv(cm.col.name)?.readonly ?? false,
      redacted: findOv(cm.col.name)?.redacted ?? cm.redacted,
      // fixed by the DB schema — value set can't be added to/removed here
      nativeOptions: selectOptions(meta.table, cm.col),
      // only meaningful (and only ever saved) when nativeOptions is null
      customOptions: findOv(cm.col.name)?.options ?? [],
      optionLabels: findOv(cm.col.name)?.optionLabels ?? {},
      order: i,
    }));

  const [tableLabel, setTableLabel] = useState(tableOv?.label ?? "");
  const [displayCol, setDisplayCol] = useState(tableOv?.displayColumn ?? "");
  const [hidden, setHidden] = useState(tableOv?.hidden ?? false);
  const [searchable, setSearchable] = useState(tableOv?.searchable ?? false);
  const [defaultSort, setDefaultSort] = useState(tableOv?.defaultSort ?? "");
  const [defaultSortDir, setDefaultSortDir] = useState<"asc" | "desc">(tableOv?.defaultSortDir ?? "desc");
  // meta.hasRealKey reflects introspection, unaffected by any pretend-PK
  // override already overlaid onto meta.table.primaryKey — using
  // meta.table.primaryKey.length here instead would make the picker
  // disappear the moment a pretend PK is saved (it'd look "real" too).
  const hasRealKey = meta.hasRealKey;
  const [pkCols, setPkCols] = useState<string[]>(tableOv?.primaryKey ?? []);
  const [cols, setCols] = useState(columnsInit);
  const [saved, setSaved] = useState(false);
  const [optionsDialogFor, setOptionsDialogFor] = useState<string | null>(null);
  const [colFilter, setColFilter] = useState("");

  // Re-seed every field when the scope itself is toggled (schema <-> pattern)
  // — the mount-time useState defaults above only apply once, so without this
  // the form would keep showing whatever the *previous* target's values were
  // instead of the new target's actual saved settings. Deliberately keyed on
  // `scope`, not `saveSchema`/pattern text: the pattern input changes value on
  // every keystroke, and resyncing off that would wipe out label/displayCol/etc
  // edits the user made in between keystrokes, and — if they hit Save before
  // finishing the pattern — silently write those wiped-blank values under
  // whatever partial (or, if pattern was still empty, the *concrete*) schema
  // saveSchema resolved to at that moment.
  useEffect(() => {
    setTableLabel(tableOv?.label ?? "");
    setDisplayCol(tableOv?.displayColumn ?? "");
    setHidden(tableOv?.hidden ?? false);
    setSearchable(tableOv?.searchable ?? false);
    setDefaultSort(tableOv?.defaultSort ?? "");
    setDefaultSortDir(tableOv?.defaultSortDir ?? "desc");
    setPkCols(tableOv?.primaryKey ?? []);
    setCols(columnsInit());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

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
          searchable,
          defaultSort: defaultSort || null,
          defaultSortDir: defaultSort ? defaultSortDir : null,
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
            hiddenInGrid: c.hiddenInGrid,
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
    <>
      <TabsContent value="settings">
        <Card className="max-w-xl p-4 gap-0">
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
          <label className="flex items-center gap-2 text-[13px] mb-2" style={{ color: "var(--muted-foreground)" }}>
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            Hide this table from the sidebar
          </label>
          <label className="flex items-center gap-2 text-[13px] mb-6" style={{ color: "var(--muted-foreground)" }}>
            <input type="checkbox" checked={searchable} onChange={(e) => setSearchable(e.target.checked)} />
            Include in global search (⌘K)
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
        </Card>

        <SaveButton save={save} saved={saved} />
      </TabsContent>

      <TabsContent value="grid">
        <Card className="max-w-xl p-4 gap-0">
          <label className="label">Default sort</label>
          <p className="text-[12px] mb-2" style={{ color: "var(--muted-foreground)" }}>
            Applied whenever nobody's picked a sort yet this session. Left unset, tables fall back to their last
            date/timestamp column, newest first.
          </p>
          <div className="flex items-center gap-2">
            <ColumnsSelect
              items={meta.table.columns}
              value={meta.table.columns.find((c) => c.name === defaultSort) ?? null}
              onChange={(col) => setDefaultSort(col?.name ?? "")}
              placeholder="auto (last date/timestamp column, desc)"
              className="flex-1"
            />
            <Chip active={defaultSortDir === "asc"} onClick={() => setDefaultSortDir("asc")}>
              Ascending
            </Chip>
            <Chip active={defaultSortDir === "desc"} onClick={() => setDefaultSortDir("desc")}>
              Descending
            </Chip>
            {defaultSort && (
              <Button variant="ghost" size="sm" onClick={() => setDefaultSort("")}>
                ✕ Clear
              </Button>
            )}
          </div>
        </Card>

        <SaveButton save={save} saved={saved} />
      </TabsContent>

      <TabsContent value="columns">
        <div className="flex items-center justify-between mb-3">
          <Input
            placeholder="Filter columns…"
            value={colFilter}
            onChange={(e) => setColFilter(e.target.value)}
            className="max-w-56"
          />
          <WidgetsHelpDialog />
        </div>
        <div className="grid grid-cols-1  lg:grid-cols-2 xl:grid-cols-3 gap-2 mb-6">
          {cols
            .map((c, i) => ({ c, i }))
            .filter(
              ({ c }) =>
                !colFilter ||
                c.name.toLowerCase().includes(colFilter.toLowerCase()) ||
                c.label.toLowerCase().includes(colFilter.toLowerCase()),
            )
            .map(({ c, i }) => {
              // "col type is enum": either natively (a real enum/check-IN
              // constraint) or because the widget dropdown was set to "select".
              const options = c.nativeOptions ?? c.customOptions;
              const isEnum = c.nativeOptions !== null || c.widget === "select" || c.customOptions.length > 0;
              const nativeCol = meta.columns.find((x) => x.col.name === c.name)?.col;
              const realFk = meta.table.foreignKeys.find((fk) => fk.columns.length === 1 && fk.columns[0] === c.name);
              const isUnique = meta.table.uniqueConstraints.some((uc) => uc.includes(c.name));
              return (
                <Card key={c.name} size="sm" className="px-3 py-2.5 gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="code text-[12px] flex-1 truncate"
                      title={nativeCol?.comment ? `${c.name} — ${nativeCol.comment}` : c.name}
                    >
                      {c.name}
                    </span>
                    {nativeCol && (
                      <span
                        className="code shrink-0"
                        style={{ fontSize: 10, color: "var(--muted-foreground-faint)" }}
                        title={`${nativeCol.dataType}${nativeCol.nullable ? "" : " · not null"}`}
                      >
                        {nativeCol.udtName}
                        {nativeCol.maxLength ? `(${nativeCol.maxLength})` : ""}
                      </span>
                    )}
                    <Button variant="secondary" size="icon-sm" onClick={() => move(i, -1)}>
                      ↑
                    </Button>
                    <Button variant="secondary" size="icon-sm" onClick={() => move(i, 1)}>
                      ↓
                    </Button>
                  </div>
                  {(realFk || isUnique || nativeCol?.default) && (
                    <div
                      className="flex flex-wrap gap-x-2 gap-y-0.5 code"
                      style={{ fontSize: 10.5, color: "var(--muted-foreground-faint)" }}
                    >
                      {realFk && (
                        <span
                          className="truncate"
                          title={`FK → ${realFk.referencedSchema}.${realFk.referencedTable}.${realFk.referencedColumns[0]}`}
                        >
                          FK → {realFk.referencedTable}.{realFk.referencedColumns[0]}
                        </span>
                      )}
                      {isUnique && <span>UNIQUE</span>}
                      {nativeCol?.default && (
                        <span className="truncate max-w-40" title={`default: ${nativeCol.default}`}>
                          default: {nativeCol.default}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex gap-1">
                    <Input
                      placeholder="Label"
                      value={c.label}
                      onChange={(e) => setCols((s) => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    />
                    <WidgetSelect
                      items={WIDGETS}
                      value={WIDGETS.find((w) => w.value === c.widget) ?? WIDGETS[0]}
                      onChange={(w) => setCols((s) => s.map((x, j) => (j === i ? { ...x, widget: w.value } : x)))}
                      className="w-full"
                    />
                  </div>
                  <div
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    <label className="flex items-center gap-1" title="Hidden everywhere — grid, kanban/gallery, and the record view/edit pages">
                      <input
                        type="checkbox"
                        checked={c.hidden}
                        onChange={(e) =>
                          setCols((s) => s.map((x, j) => (j === i ? { ...x, hidden: e.target.checked } : x)))
                        }
                      />
                      hidden
                    </label>
                    <label
                      className="flex items-center gap-1"
                      title="Hidden from the grid/kanban/gallery only — still shown on the record view/edit pages"
                    >
                      <input
                        type="checkbox"
                        checked={c.hiddenInGrid}
                        onChange={(e) =>
                          setCols((s) => s.map((x, j) => (j === i ? { ...x, hiddenInGrid: e.target.checked } : x)))
                        }
                      />
                      hidden in grid
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

        <SaveButton save={save} saved={saved} />
      </TabsContent>

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
    </>
  );
}
