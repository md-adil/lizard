"use client";

// Inline create/edit card for a single dashboard variable, rendered directly
// in the settings page's Variables list (app/dashboards/[id]/settings) —
// no dialog, since the page already has the room. A "select" variable's
// option source (static list vs. live query) is a tab within the type, not
// a third top-level type. Prebuilt kinds are added deliberately (each fully
// realized, e.g. "daterange" gets a real range picker) rather than growing
// into a wide menu of thin stubs.
import { useState } from "react";
import type { ChartSpec, DashboardVariable, QueryResult, SelectSource, VariableOption } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SqlEditor } from "@/components/ui/sql-editor";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ColumnsSelect } from "@/components/browse/columns-select";
import { useCatalog } from "@/components/browse/use-catalog";
import { SearchableSelect, optionsFromResult, DateRangeField } from "@/components/charts/variable-controls";

const VAR_TYPE_OPTIONS: { value: DashboardVariable["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "select", label: "Select" },
  { value: "daterange", label: "Date range" },
];

// name must stay identifier-shaped (matched by \{\{(\w+)\}\} in
// substituteVariables), so a label like "Order status" becomes "order_status".
function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function defaultStaticSource(): SelectSource {
  return { kind: "static", options: [] };
}

function defaultQuerySource(): SelectSource {
  return {
    kind: "query",
    target: "single" as ChartSpec["target"],
    connections: [],
    sql: "",
    dialect: "postgres" as ChartSpec["dialect"],
    valueField: null,
    labelField: null,
  };
}

// Label/value pair editor for a static "select" source — unlike a query
// source there's no live data to derive label vs. value from.
function OptionsEditor({ options, onChange }: { options: VariableOption[]; onChange: (options: VariableOption[]) => void }) {
  const setOption = (i: number, patch: Partial<VariableOption>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const removeOption = (i: number) => onChange(options.filter((_, idx) => idx !== i));
  const addOption = () => onChange([...options, { label: "", value: "" }]);

  return (
    <div className="space-y-2">
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input placeholder="Label" value={o.label} onChange={(e) => setOption(i, { label: e.target.value })} />
          <Input placeholder="Value" value={o.value} onChange={(e) => setOption(i, { value: e.target.value })} />
          <Button variant="secondary" size="sm" aria-label="Remove option" onClick={() => removeOption(i)}>
            ✕
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={addOption}>
        ＋ Add option
      </Button>
    </div>
  );
}

// A date range is a single dashboard-wide concept (like Grafana's built-in
// time picker), not something you'd name differently per instance — so
// unlike text/select it gets a fixed name/label instead of user input.
const DATERANGE_NAME = "datetime";
const DATERANGE_LABEL = "Date range";

export function VariableFormCard({
  initial,
  disableDateRange = false,
  onCancel,
  onSave,
}: {
  initial: DashboardVariable | null;
  // Hide "Date range" from the type picker — passed by the settings page
  // when another date range variable already exists (there's only one
  // dashboard-wide range, so a second one would collide on DATERANGE_NAME).
  disableDateRange?: boolean;
  onCancel: () => void;
  onSave: (variable: DashboardVariable) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<DashboardVariable>(initial ?? { name: "", label: "", type: "text", value: "" });
  const [saving, setSaving] = useState(false);
  const { data: catalog } = useCatalog();
  const queryConnections = (catalog?.connections ?? []).filter((c) => !c.error && c.engine !== "mongo");
  const [preview, setPreview] = useState<{ result?: QueryResult; error?: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const typeOptions = VAR_TYPE_OPTIONS.filter((o) => o.value !== "daterange" || !disableDateRange);

  const setType = (type: DashboardVariable["type"]) => {
    setDraft((d): DashboardVariable => {
      if (type === "text") return { name: d.name, label: d.label, type, value: "" };
      if (type === "daterange")
        return { name: DATERANGE_NAME, label: DATERANGE_LABEL, type, from: "", to: "", includeTime: false };
      return { name: d.name, label: d.label, type, source: defaultStaticSource(), value: "" };
    });
    setPreview(null);
  };

  // Keeps name in sync with label while the user hasn't typed a name of
  // their own yet — saves re-typing "order status" as "order_status" for the
  // common case, without fighting a name someone deliberately customized.
  const setLabel = (label: string) =>
    setDraft((d) => ({ ...d, label, name: d.name === "" ? slugify(label) : d.name }) as DashboardVariable);

  const setSourceKind = (kind: SelectSource["kind"]) => {
    if (draft.type !== "select") return;
    setDraft((d) =>
      d.type === "select" ? { ...d, source: kind === "static" ? defaultStaticSource() : defaultQuerySource(), value: "" } : d,
    );
    setPreview(null);
  };

  const patchQuerySource = (patch: Partial<Extract<SelectSource, { kind: "query" }>>) =>
    setDraft((d) =>
      d.type === "select" && d.source.kind === "query" ? { ...d, source: { ...d.source, ...patch } } : d,
    );

  const runPreview = async () => {
    if (draft.type !== "select" || draft.source.kind !== "query") return;
    const source = draft.source;
    setPreviewBusy(true);
    setPreview(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: source.target,
          connections: source.connections,
          sql: source.sql,
          dialect: source.dialect,
        }),
      });
      const body = await res.json();
      if (!res.ok) setPreview({ error: body.error ?? "query failed" });
      else setPreview({ result: body });
    } finally {
      setPreviewBusy(false);
    }
  };

  const querySource = draft.type === "select" && draft.source.kind === "query" ? draft.source : null;
  const previewOptions =
    querySource && preview?.result ? optionsFromResult(preview.result, querySource.valueField, querySource.labelField) : [];

  const canSave =
    draft.type === "daterange" ||
    (draft.label.trim().length > 0 &&
      /^\w+$/.test(draft.name) &&
      (draft.type !== "select" ||
        draft.source.kind === "static" ||
        (draft.source.connections.length > 0 && draft.source.sql.trim().length > 0)));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="text-[13px] font-semibold">{initial ? "Edit variable" : "New variable"}</div>

      <div>
        <label className="label">Type</label>
        <SearchableSelect
          items={typeOptions}
          value={typeOptions.find((o) => o.value === draft.type) ?? null}
          onChange={(o) => o && setType(o.value)}
          className="w-full sm:w-64"
        />
      </div>

      {/* A date range is one fixed dashboard-wide concept (Grafana's built-in
          time picker) — no name/label to pick, unlike text/select which can
          have any number of differently-named instances. */}
      {draft.type !== "daterange" && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Label</label>
            <Input value={draft.label} placeholder="Order status" autoFocus onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <label className="label">Name</label>
            <Input
              value={draft.name}
              placeholder="status"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }) as DashboardVariable)}
            />
          </div>
        </div>
      )}

      {draft.type === "daterange" && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-[13px] select-none cursor-pointer">
            <Switch
              size="sm"
              checked={draft.includeTime}
              onCheckedChange={(checked) =>
                // Reset from/to on format change — a bare "yyyy-MM-dd" and a
                // "yyyy-MM-dd HH:mm" shouldn't be silently reinterpreted.
                setDraft((d) => (d.type === "daterange" ? { ...d, includeTime: checked, from: "", to: "" } : d))
              }
            />
            Include time
          </label>
          <div>
            <label className="label">Default range</label>
            <DateRangeField
              from={draft.from}
              to={draft.to}
              includeTime={draft.includeTime}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }) as DashboardVariable)}
            />
          </div>
        </div>
      )}

      {draft.type === "text" && (
        <div>
          <label className="label">Default value</label>
          <Input
            value={draft.value}
            onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }) as DashboardVariable)}
          />
        </div>
      )}

      {draft.type === "select" && (
        <div>
          <Tabs value={draft.source.kind} onValueChange={(v) => setSourceKind(v as SelectSource["kind"])} className="mb-3">
            <TabsList>
              <TabsTrigger value="static">Static list</TabsTrigger>
              <TabsTrigger value="query">From query</TabsTrigger>
            </TabsList>
          </Tabs>

          {draft.source.kind === "static" && (
            <div className="space-y-3">
              <div>
                <label className="label">Options</label>
                <OptionsEditor
                  options={draft.source.options}
                  onChange={(options) =>
                    setDraft((d) => (d.type === "select" ? { ...d, source: { kind: "static", options } } : d))
                  }
                />
              </div>
              <div>
                <label className="label">Default value</label>
                <SearchableSelect
                  items={draft.source.options}
                  value={draft.source.options.find((o) => o.value === draft.value) ?? null}
                  onChange={(o) => setDraft((d) => ({ ...d, value: o?.value ?? "" }) as DashboardVariable)}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {querySource && (
            <div className="space-y-3">
              <div>
                <label className="label">Connection</label>
                <SearchableSelect
                  items={queryConnections}
                  value={queryConnections.find((c) => c.connectionName === querySource.connections[0]) ?? null}
                  onChange={(c) =>
                    patchQuerySource({
                      connections: c ? [c.connectionName] : [],
                      dialect: c?.engine === "mysql" ? "mysql" : "postgres",
                    })
                  }
                  getValue={(c) => c.connectionName}
                  getLabel={(c) => c.connectionName}
                  placeholder="— connection —"
                  className="w-full"
                />
              </div>
              <div>
                <label className="label">SQL</label>
                <SqlEditor
                  placeholder="SELECT id, name FROM statuses"
                  value={querySource.sql}
                  onChange={(sql) => patchQuerySource({ sql })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={previewBusy || !querySource.connections.length || !querySource.sql.trim()}
                  onClick={runPreview}
                >
                  {previewBusy ? "Running…" : "Run preview"}
                </Button>
                {preview?.result && (
                  <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                    {previewOptions.length} distinct value{previewOptions.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {preview?.error && (
                <div
                  className="rounded-md border px-3 py-2 text-[13px]"
                  style={{ color: "var(--destructive)", borderColor: "rgba(229,83,75,.4)" }}
                >
                  {preview.error}
                </div>
              )}
              {preview?.result && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Value column</label>
                    <ColumnsSelect
                      items={preview.result.columns}
                      value={preview.result.columns.find((c) => c.name === querySource.valueField) ?? null}
                      onChange={(c) => patchQuerySource({ valueField: c?.name ?? null })}
                      placeholder={preview.result.columns[0]?.name ?? "— column —"}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="label">Label column (optional)</label>
                    <ColumnsSelect
                      items={preview.result.columns}
                      value={preview.result.columns.find((c) => c.name === querySource.labelField) ?? null}
                      onChange={(c) => patchQuerySource({ labelField: c?.name ?? null })}
                      placeholder="same as value column"
                      className="w-full"
                    />
                  </div>
                </div>
              )}
              {preview?.result && (
                <div className="flex gap-1.5 flex-wrap max-h-32 overflow-y-auto scrollbar-thin p-0.5">
                  {previewOptions.length === 0 && (
                    <span className="text-[12px]" style={{ color: "var(--muted-foreground-faint)" }}>
                      No rows returned.
                    </span>
                  )}
                  {previewOptions.map((o) => (
                    <Badge
                      key={o.value}
                      variant={draft.value === o.value ? "default" : "outline"}
                      className={draft.value === o.value ? undefined : "bg-muted"}
                      render={<button onClick={() => setDraft((d) => ({ ...d, value: o.value }) as DashboardVariable)} />}
                    >
                      {o.label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
        {draft.type === "select" &&
          draft.source.kind === "query" &&
          "The value column is substituted into panel SQL; the label column is only for display. "}
        {draft.type === "daterange" ? (
          <>
            Use <span className="code">{`{{${DATERANGE_NAME}.from}}`}</span>/
            <span className="code">{`{{${DATERANGE_NAME}.to}}`}</span> in panel SQL.
          </>
        ) : (
          <>
            Use <span className="code">{`{{${draft.name || "name"}}}`}</span> in panel SQL.
          </>
        )}
      </p>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!canSave || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}
