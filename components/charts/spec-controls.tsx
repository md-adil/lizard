"use client";

// Field controls to shape a ChartSpec against a known QueryResult. Rendered
// as a narrow, full-height rail (Grafana's panel-options sidebar) — grouped
// into labeled sections rather than one flat stack.
import { useMemo } from "react";
import type { ChartSpec, ChartType, QueryResult } from "@/lib/types";
import { CHART_TYPES } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ColumnsSelect } from "@/components/browse/columns-select";
import { ChartTypeSelect } from "@/components/charts/chart-type-select";
import { DataSelect } from "@/components/ui/data-select";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { useCatalog } from "@/components/browse/use-catalog";
import { useConnectionSchemas } from "@/components/browse/use-connection-schemas";
import { useSchemaMeta, connectionSupportsSchemas } from "@/components/browse/useTableMeta";
import { effectiveKey } from "@/lib/introspect/heuristics";

// Label sits outside its own bordered box — the same outside-label pattern
// as the modal's "Data source"/"Preview" blocks, rather than one shared card
// with internal section dividers.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div
        className="text-[11px] font-semibold tracking-wide uppercase"
        style={{ color: "var(--muted-foreground-faint)" }}
      >
        {title}
      </div>
      <div className="panel p-3 space-y-2.5" style={{ background: "var(--background)" }}>
        {children}
      </div>
    </div>
  );
}

export function SpecControls({
  spec,
  result,
  onChange,
}: {
  spec: ChartSpec;
  result: QueryResult;
  onChange: (spec: ChartSpec) => void;
}) {
  const cols = result.columns.map((c) => c.name);
  const columnsByName = useMemo(() => new Map(result.columns.map((c) => [c.name, c])), [result.columns]);

  // "Details link" (row click → record page) state, driven off spec.linkTo —
  // picking a connection seeds a linkTo object with the rest blank; clearing
  // the connection drops it back to null. ChartRenderer only wires the click
  // once connection/table/keyField/keyColumn are all non-empty.
  const link = spec.linkTo;
  const { data: catalog } = useCatalog();
  const linkConnections = (catalog?.connections ?? []).filter((c) => !c.error);
  const linkConnection = link?.connection ?? "";
  const linkHasSchema = !!linkConnection && !!catalog && connectionSupportsSchemas(catalog, linkConnection);
  const { schemas: linkSchemas } = useConnectionSchemas(linkHasSchema ? linkConnection : undefined);
  const linkSchema = link?.schema ?? "";
  const { schemaMeta: linkSchemaMeta } = useSchemaMeta(
    linkConnection || undefined,
    linkHasSchema ? linkSchema || undefined : undefined,
  );
  const linkTables = linkSchemaMeta?.tables ?? [];
  const linkTableInfo = linkTables.find((t) => t.name === link?.table);

  function setLink(patch: Partial<NonNullable<ChartSpec["linkTo"]>>) {
    const merged = {
      connection: link?.connection ?? "",
      schema: link?.schema ?? null,
      table: link?.table ?? "",
      keyField: link?.keyField ?? "",
      keyColumn: link?.keyColumn ?? "",
      ...patch,
    };
    onChange({ ...spec, linkTo: merged.connection ? merged : null });
  }

  return (
    <div className="space-y-4">
      <Section title="Panel">
        <div>
          <label className="label">Title</label>
          <Input value={spec.title} onChange={(e) => onChange({ ...spec, title: e.target.value })} />
        </div>
        <div>
          <label className="label">Chart type</label>
          <ChartTypeSelect value={spec.chartType} onChange={(chartType) => onChange({ ...spec, chartType })} />
        </div>
      </Section>

      {/* "table" has no configurable fields — X field is hidden and Y fields
          only render for non-table types, so the whole section would just be
          an empty box for it. */}
      {spec.chartType !== "table" && (
        <Section title="Fields">
          {CHART_TYPES[spec.chartType].needsXField && (
            <div>
              <label className="label">X field</label>
              <ColumnsSelect
                items={result.columns}
                value={(spec.xField ? columnsByName.get(spec.xField) : null) ?? null}
                onChange={(col) => onChange({ ...spec, xField: col?.name ?? null })}
                placeholder="—"
                className="w-full"
              />
            </div>
          )}
          <div>
            <label className="label">{CHART_TYPES[spec.chartType].singleValueField ? "Value field" : "Y fields"}</label>
            <div className="flex gap-1.5 flex-wrap max-h-32 overflow-y-auto scrollbar-thin p-0.5">
              {cols.map((c) => {
                const active = spec.yFields.includes(c);
                return (
                  <Badge
                    key={c}
                    variant={active ? "default" : "outline"}
                    className={active ? undefined : "bg-muted"}
                    render={
                      <button
                        onClick={() =>
                          onChange({
                            ...spec,
                            yFields: active ? spec.yFields.filter((y) => y !== c) : [...spec.yFields, c].slice(0, 6),
                          })
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
          {(spec.chartType === "heatmap" ||
            (["line", "area", "area-stacked", "bar", "bar-stacked", "bar-horizontal"].includes(spec.chartType) &&
              spec.yFields.length === 1)) && (
            <div>
              <label className="label">
                {spec.chartType === "heatmap" ? "Y field (rows)" : "Split into series by (optional)"}
              </label>
              <ColumnsSelect
                items={result.columns.filter((c) => !spec.yFields.includes(c.name) && c.name !== spec.xField)}
                value={(spec.seriesField ? columnsByName.get(spec.seriesField) : null) ?? null}
                onChange={(col) => onChange({ ...spec, seriesField: col?.name ?? null })}
                placeholder="—"
                className="w-full"
              />
            </div>
          )}
        </Section>
      )}

      {spec.chartType === "table" && (
        <Section title="Details link">
          <div>
            <label className="label">Connection</label>
            <DataSelect
              items={linkConnections}
              value={linkConnections.find((c) => c.connectionName === linkConnection) ?? null}
              onChange={(c) => setLink({ connection: c?.connectionName ?? "", schema: null, table: "", keyColumn: "" })}
              getValue={(c) => c.connectionName}
              getLabel={(c) => c.connectionName}
              placeholder="— none —"
              clearable
              className="w-full"
            />
          </div>
          {linkConnection && linkHasSchema && (
            <div>
              <label className="label">Schema</label>
              <DataSelect
                items={linkSchemas}
                value={linkSchemas.find((s) => s.name === linkSchema) ?? null}
                onChange={(s) => setLink({ schema: s?.name ?? null, table: "", keyColumn: "" })}
                getValue={(s) => s.name}
                getLabel={(s) => s.name}
                placeholder="— select —"
                className="w-full"
              />
            </div>
          )}
          {linkConnection && (
            <div>
              <label className="label">Table</label>
              <Combobox
                items={linkTables.map((t) => t.name)}
                value={link?.table ?? ""}
                onValueChange={(name) => {
                  if (!name) return;
                  const t = linkTables.find((x) => x.name === name);
                  setLink({ table: name, keyColumn: t ? (effectiveKey(t)[0] ?? t.columns[0]?.name ?? "") : "" });
                }}
              >
                <ComboboxInput placeholder="— select table —" className="w-full" />
                <ComboboxContent>
                  <ComboboxEmpty>No tables found</ComboboxEmpty>
                  <ComboboxList>
                    {(t) => (
                      <ComboboxItem key={t} value={t}>
                        {t}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
          )}
          {linkConnection && link?.table && (
            <>
              <div>
                <label className="label">Key field (this query's column)</label>
                <ColumnsSelect
                  items={result.columns}
                  value={(link.keyField ? columnsByName.get(link.keyField) : null) ?? null}
                  onChange={(col) => setLink({ keyField: col?.name ?? "" })}
                  placeholder="— select column —"
                  className="w-full"
                />
              </div>
              <div>
                <label className="label">Matches target column</label>
                <ColumnsSelect
                  items={linkTableInfo?.columns ?? []}
                  value={linkTableInfo?.columns.find((c) => c.name === link.keyColumn) ?? null}
                  onChange={(col) => setLink({ keyColumn: col?.name ?? "" })}
                  placeholder="— select column —"
                  className="w-full"
                />
              </div>
            </>
          )}
        </Section>
      )}

      {(spec.chartType === "stat" || spec.chartType === "gauge") && (
        <Section title="Thresholds">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Warn at</label>
              <Input
                type="number"
                value={spec.thresholds?.warn ?? ""}
                onChange={(e) =>
                  onChange({
                    ...spec,
                    thresholds: {
                      warn: e.target.value === "" ? null : Number(e.target.value),
                      crit: spec.thresholds?.crit ?? null,
                      highIsBad: spec.thresholds?.highIsBad ?? true,
                    },
                  })
                }
                placeholder="—"
              />
            </div>
            <div>
              <label className="label">Crit at</label>
              <Input
                type="number"
                value={spec.thresholds?.crit ?? ""}
                onChange={(e) =>
                  onChange({
                    ...spec,
                    thresholds: {
                      crit: e.target.value === "" ? null : Number(e.target.value),
                      warn: spec.thresholds?.warn ?? null,
                      highIsBad: spec.thresholds?.highIsBad ?? true,
                    },
                  })
                }
                placeholder="—"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] select-none cursor-pointer">
            <Switch
              size="sm"
              checked={spec.thresholds?.highIsBad ?? true}
              onCheckedChange={(checked) =>
                onChange({
                  ...spec,
                  thresholds: { warn: spec.thresholds?.warn ?? null, crit: spec.thresholds?.crit ?? null, highIsBad: checked },
                })
              }
            />
            Higher is bad
          </label>
        </Section>
      )}

      <Section title="Caching">
        <div>
          <label className="label">Server cache (seconds)</label>
          <Input
            type="number"
            min={0}
            max={3600}
            value={spec.cacheSeconds ?? ""}
            onChange={(e) => onChange({ ...spec, cacheSeconds: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="off"
          />
        </div>
      </Section>
    </div>
  );
}
