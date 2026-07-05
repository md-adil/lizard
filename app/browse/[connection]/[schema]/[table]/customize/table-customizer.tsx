"use client";

// Full-page table customization: table + column overrides and virtual
// relationships, with a page-level source scope (this schema, or a schema
// schema). Replaces the old CustomizePanel drawer.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCatalog,
  buildTableMeta,
  type TableMeta,
  type CatalogResponse,
} from "@/components/browse/useTableMeta";
import { resolveColumnOverrides } from "@/lib/introspect/overrides";
import { SAME_SCHEMA, matchesGlob } from "@/lib/introspect/virtual-fk";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VirtualFkEditor } from "./virtual-fk-editor";

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
  "readonly",
];

export function TableCustomizer({
  connection,
  schema,
  table,
}: {
  connection: string;
  schema: string;
  table: string;
}) {
  const { data: catalog, isLoading } = useCatalog();
  const meta = useMemo(
    () => (catalog ? buildTableMeta(catalog, connection, schema, table) : null),
    [catalog, connection, schema, table],
  );

  const backHref = `/browse/${connection}/${schema}/${table}`;

  if (isLoading) return <Pad>Loading…</Pad>;
  if (!catalog || !meta)
    return (
      <Pad>
        Table {schema}.{table} not found on “{connection}”.{" "}
        <Link href={backHref} className="underline">
          Back
        </Link>
      </Pad>
    );

  return (
    <CustomizeForm
      meta={meta}
      catalog={catalog}
      connection={connection}
      backHref={backHref}
    />
  );
}

function CustomizeForm({
  meta,
  catalog,
  connection,
  backHref,
}: {
  meta: TableMeta;
  catalog: CatalogResponse;
  connection: string;
  backHref: string;
}) {
  const qc = useQueryClient();

  // page-level source scope
  const [scope, setScope] = useState<"schema" | "pattern">("schema");
  const [pattern, setPattern] = useState("");
  const saveSchema = scope === "pattern" && pattern ? pattern : meta.schema;
  const matchedSchemas =
    scope === "pattern" && pattern
      ? (catalog.connections
          .find((c) => c.connectionName === connection)
          ?.schemas.filter((s) => matchesGlob(pattern, s.name))
          .map((s) => s.name) ?? [])
      : [];

  const colOv = resolveColumnOverrides(
    catalog.columnOverrides,
    meta.connectionId,
    meta.schema,
    meta.table.name,
  );
  const findOv = (name: string) => colOv.find((o) => o.column === name);

  const [tableLabel, setTableLabel] = useState(meta.tableOverride?.label ?? "");
  const [displayCol, setDisplayCol] = useState(
    meta.tableOverride?.displayColumn ?? "",
  );
  const [hidden, setHidden] = useState(meta.tableOverride?.hidden ?? false);
  const [cols, setCols] = useState(
    meta.columns.map((cm, i) => ({
      name: cm.col.name,
      label: findOv(cm.col.name)?.label ?? "",
      widget: findOv(cm.col.name)?.widget ?? "",
      hidden: cm.hidden,
      readonly: findOv(cm.col.name)?.readonly ?? false,
      order: i,
    })),
  );
  const [saved, setSaved] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({
      queryKey: ["rows", meta.connection, meta.schema, meta.table.name],
    });
  }

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

  return (
    <div className="px-8 py-8 max-w-6xl">
      <div className="flex items-center gap-2 mb-1 text-[13px]">
        <Link
          href={backHref}
          className="underline"
          style={{ color: "var(--text-dim)" }}
        >
          ← {meta.label}
        </Link>
      </div>
      <h1 className="text-lg font-semibold mb-4">Customize “{meta.label}”</h1>

      {/* page-level source scope */}
      <Tabs
        value={scope}
        onValueChange={(v) => setScope(v as "schema" | "pattern")}
        className="mb-4"
      >
        <TabsList variant="line">
          <TabsTrigger value="schema">This schema ({meta.schema})</TabsTrigger>
          <TabsTrigger value="pattern">Schema pattern</TabsTrigger>
        </TabsList>
      </Tabs>
      {scope === "pattern" && (
        <div className="mb-5">
          <input
            className="input"
            placeholder="schema pattern, e.g. org_*"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          <p
            className="text-[11px] mt-1"
            style={{ color: "var(--text-faint)" }}
          >
            {pattern
              ? `matches ${matchedSchemas.length}: ${matchedSchemas.slice(0, 8).join(", ")}${matchedSchemas.length > 8 ? "…" : ""}`
              : "everything on this page is saved once and applied to every matching schema. Exact per-schema overrides still win."}
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-8 items-start">
        <div>
          {/* left column: table + column overrides */}
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
              <label className="label">
                Display column (used for FK labels)
              </label>
              <select
                className="input"
                value={displayCol}
                onChange={(e) => setDisplayCol(e.target.value)}
              >
                <option value="">auto ({meta.displayColumn})</option>
                {meta.table.columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label
            className="flex items-center gap-2 text-[13px] mb-6"
            style={{ color: "var(--text-dim)" }}
          >
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            Hide this table from the sidebar
          </label>

          <SectionTitle>Columns</SectionTitle>
          <div className="space-y-2 mb-6">
            {cols.map((c, i) => (
              <div key={c.name} className="panel px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className="code text-[12px] flex-1 truncate"
                    title={c.name}
                  >
                    {c.name}
                  </span>
                  <input
                    className="input flex-2"
                    style={{ padding: "3px 8px", fontSize: 12 }}
                    placeholder="Label"
                    value={c.label}
                    onChange={(e) =>
                      setCols((s) =>
                        s.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <select
                    className="input flex-1"
                    style={{ padding: "3px 6px", fontSize: 12 }}
                    value={c.widget}
                    onChange={(e) =>
                      setCols((s) =>
                        s.map((x, j) =>
                          j === i ? { ...x, widget: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {WIDGETS.map((w) => (
                      <option key={w} value={w}>
                        {w || "auto"}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-sm" onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button className="btn btn-sm" onClick={() => move(i, 1)}>
                    ↓
                  </button>
                </div>
                <div
                  className="flex gap-4 mt-1.5 text-[12px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={c.hidden}
                      onChange={(e) =>
                        setCols((s) =>
                          s.map((x, j) =>
                            j === i ? { ...x, hidden: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                    hidden
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={c.readonly}
                      onChange={(e) =>
                        setCols((s) =>
                          s.map((x, j) =>
                            j === i ? { ...x, readonly: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                    readonly
                  </label>
                </div>
              </div>
            ))}
          </div>

          <button
            className="btn btn-primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? "Saving…"
              : saved
                ? "Saved ✓"
                : "Save customizations"}
          </button>
        </div>

        <div>
          {/* right column: virtual relationships */}
          <SectionTitle>Virtual relationships</SectionTitle>
          <p
            className="text-[12.5px] mb-3"
            style={{ color: "var(--text-dim)" }}
          >
            Link this table to another — composite keys, constant filters,
            case-insensitive matches. Powers reference labels/pickers and tells
            the AI how to join.
          </p>
          <VirtualFkEditor
            meta={meta}
            catalog={catalog}
            fromSchema={saveSchema}
            fromTable={meta.table.name}
            defaultToSchema={scope === "pattern" ? SAME_SCHEMA : meta.schema}
            onSaved={invalidate}
          />
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[12px] font-semibold uppercase tracking-wider mb-2"
      style={{ color: "var(--text-faint)" }}
    >
      {children}
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-8 py-10 text-[14px]"
      style={{ color: "var(--text-dim)" }}
    >
      {children}
    </div>
  );
}
