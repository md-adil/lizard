"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTableMeta, connectionSupportsSchemas, formatCell, type TableMeta } from "@/components/browse/useTableMeta";
import { dataApiUrl } from "@/components/browse/data-api";
import type { FkLabels } from "@/lib/types";
import { fkLabelFor } from "@/lib/data/fk-labels";
import { RowEditor } from "@/components/browse/row-editor";
import { RedactedValue } from "@/components/browse/redacted-value";
import { NullValue } from "@/components/browse/null-value";
import { RecordComments } from "@/components/browse/record-comments";
import { LinkedRecordsCard } from "@/components/browse/linked-records-card";
import { ReferenceHoverPreview } from "@/components/browse/reference-hover-preview";
import { DataGrid } from "@/components/browse/data-grid";
import { JsonView, JsonSyntax } from "@/components/browse/json-view";
import { MediaPreview, type MediaKind } from "@/components/browse/media-preview";
import { ShadowDom } from "@/components/ui/shadow-dom";
import { useSchemaParam, tableHref, recordHref } from "@/components/browse/use-schema-param";
import { humanize, effectiveKey } from "@/lib/introspect/heuristics";
import { SAME_SCHEMA, isPattern, vfkDisplayColumn } from "@/lib/introspect/virtual-fk";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { widgetIcons, type Widget } from "@/lib/data/widgets";
import { BooleanValue, isBooleanField } from "@/components/browse/boolean-value";
import { Check, CalendarDays, Link2, Copy, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Breadcrumbs } from "@/components/breadcrumbs";

function RelatedCard({
  title,
  subtitle,
  menu,
  children,
}: {
  title: string;
  subtitle?: string;
  menu?: {
    label: string;
    onClick?: () => void;
    href?: string;
    danger?: boolean;
  }[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="p-4 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[13.5px] font-semibold truncate">{title}</span>
        {subtitle && (
          <span className="tag code" style={{ fontSize: 10 }}>
            {subtitle}
          </span>
        )}
        <span className="flex-1" />
        <Button variant="secondary" size="sm" title="Enlarge" onClick={() => setExpanded(true)}>
          ⤢
        </Button>
        {menu && menu.length > 0 && (
          <div className="relative">
            <Button variant="secondary" size="sm" onClick={() => setOpen((s) => !s)}>
              ⋯
            </Button>
            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div
                  className="absolute right-0 z-20 mt-1 w-44 rounded-md border py-1"
                  style={{
                    background: "var(--muted)",
                    borderColor: "var(--input)",
                  }}
                >
                  {menu.map((m) =>
                    m.href ? (
                      <Link
                        key={m.label}
                        href={m.href}
                        className="block px-3 py-1.5 text-[12.5px] hoverable"
                        style={{
                          color: m.danger ? "var(--destructive)" : "var(--foreground)",
                        }}
                        onClick={() => setOpen(false)}
                      >
                        {m.label}
                      </Link>
                    ) : (
                      <Button
                        variant="ghost"
                        className="block w-full text-left px-3 py-1.5 text-[12.5px] hoverable"
                        key={m.label}
                        style={{
                          color: m.danger ? "var(--destructive)" : "var(--foreground)",
                        }}
                        onClick={() => {
                          setOpen(false);
                          m.onClick?.();
                        }}
                      >
                        {m.label}
                      </Button>
                    ),
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {children}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          showCloseButton
          className="top-[5vh] translate-y-0 flex flex-col resize overflow-auto gap-0 rounded-xl"
          style={{
            background: "var(--card)",
            width: "min(90vw, 1100px)",
            height: "min(60vh, 640px)",
            minWidth: 360,
            minHeight: 200,
            maxWidth: "95vw",
            maxHeight: "90vh",
          }}
        >
          <div className="flex items-center gap-2 mb-4 pr-6">
            <DialogTitle className="text-[16px] font-semibold">{title}</DialogTitle>
            {subtitle && (
              <span className="tag code" style={{ fontSize: 10 }}>
                {subtitle}
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin pr-1 text-[13.5px]">{children}</div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// widgets whose values are long-form and read better full-width, wrapping
// instead of being clipped to a single grid cell.
const WIDE_WIDGETS = new Set<Widget>(["textarea", "markdown", "tag", "array", "json"]);
// numeric widgets — emphasized with tabular figures so columns of digits align.
const NUMERIC_WIDGETS = new Set<Widget>(["number", "currency", "percent", "range"]);

// Copies a field's raw value; appears on hover next to the field label.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy value"
      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

// A real json/jsonb column arrives already parsed into an object; a text
// column with its widget overridden to "json" arrives as a raw string that
// still needs parsing to render as structured JSON.
function parseJsonFieldValue(value: unknown): unknown {
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

// Expand trigger for a JSON field — same hover-revealed icon-button style as
// CopyButton, placed right beside it in the label row (see FieldList) rather
// than next to the value itself. Opens a dialog with the full value
// (structured tree or raw text, toggleable, same as JsonCard used to offer).
// Editing still goes through the record's "✎ Edit" form (RowEditor already
// renders JSON columns as an editable textarea), so this is display-only.
function JsonExpandButton({ cm, value }: { cm: TableMeta["columns"][number]; value: unknown }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const parsed = parseJsonFieldValue(value);
  const pretty = JSON.stringify(parsed, null, 2);
  return (
    <>
      <button
        type="button"
        title="View JSON"
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => setOpen(true)}
      >
        <Maximize2 className="size-3" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className="top-[5vh] translate-y-0 flex flex-col resize overflow-auto gap-0 rounded-xl"
          style={{
            background: "var(--card)",
            width: "min(90vw, 1100px)",
            height: "min(60vh, 640px)",
            minWidth: 360,
            minHeight: 200,
            maxWidth: "95vw",
            maxHeight: "90vh",
          }}
        >
          <div className="flex items-center gap-2 mb-4 pr-6">
            <DialogTitle className="text-[16px] font-semibold">{cm.label}</DialogTitle>
            <span className="tag code" style={{ fontSize: 10 }}>
              json
            </span>
            <span className="flex-1" />
            <Button variant="secondary" size="sm" onClick={() => setRaw((r) => !r)}>
              {raw ? "Show structured" : "Show raw JSON"}
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin pr-1 text-[13.5px]">
            {raw ? (
              <pre className="code text-[12px] whitespace-pre-wrap" style={{ color: "var(--foreground)" }}>
                <JsonSyntax text={pretty} />
              </pre>
            ) : (
              <JsonView value={parsed} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// One field's value, rendered according to its widget/data type. `formatCell`
// already produces rich `icon` nodes for many widgets (rating, currency, tag,
// color, url…); this layer adds type-appropriate framing on top: badges for
// booleans/selects, emphasized figures for numbers, a calendar affordance for
// dates, and a wrapping block for long-form text. `emphasize` gives key
// (primary-key / display) fields a larger, heavier value.
function FieldValue({
  cm,
  value,
  label,
  isMedia,
  wide,
  emphasize,
}: {
  cm: TableMeta["columns"][number];
  value: unknown;
  label: string | undefined;
  isMedia: boolean;
  wide: boolean;
  emphasize?: boolean;
}) {
  const size = emphasize ? "text-[15px]" : "text-[13px]";
  if (cm.redacted) return <RedactedValue value={value} />;

  if (isMedia) {
    return (
      <MediaPreview
        kind={cm.widget as MediaKind}
        value={value as string}
        className={cm.widget === "audio" ? "w-full" : "h-16 rounded border object-cover"}
      />
    );
  }

  const f = formatCell(value, cm.widget, cm.optionLabels);
  // `formatCell` clips plain strings to a preview length for grids — on the
  // record page we want the whole value, so use the raw string as-is.
  const fullText = typeof value === "string" ? value : f.text;

  // resolved foreign-key reference: human label + the raw key value. Hovering
  // it previews a few fields of the row it points at.
  if (label && cm.ref) {
    return (
      <ReferenceHoverPreview target={cm.ref} value={value}>
        <span className={`${size} wrap-break-word cursor-default ${emphasize ? "font-semibold" : ""}`}>
          {label}{" "}
          <span className="tag code" style={{ fontSize: 10 }}>
            {String(value)}
          </span>
        </span>
      </ReferenceHoverPreview>
    );
  }

  if (value == null) {
    return <NullValue className="text-[13px]" />;
  }

  // json/jsonb → the structured tree by default, same as the dialog's
  // default view (raw JSON text is opt-in there, via its toggle). The
  // expand-to-dialog trigger lives in the label row beside CopyButton (see
  // FieldList/JsonExpandButton), not here.
  if (cm.widget === "json") {
    return (
      <div className="max-h-56 overflow-auto scrollbar-thin text-[12.5px]">
        <JsonView value={parseJsonFieldValue(value)} />
      </div>
    );
  }

  // boolean / toggle → a compact yes/no pill instead of a bare icon.
  if (isBooleanField(cm.widget, value)) {
    return <BooleanValue value={!f.muted} variant="pill" className="mt-0.5" />;
  }

  // single-select / enum → a badge so the chosen option reads as a token.
  if (cm.widget === "select") {
    return (
      <Badge variant="secondary" className="mt-0.5 max-w-full truncate">
        {f.text}
      </Badge>
    );
  }

  // date / datetime → calendar affordance + value.
  if ((cm.widget === "date" || cm.widget === "datetime") && !f.icon) {
    return (
      <div className={`flex items-center gap-1.5 tabular-nums ${size}`}>
        <CalendarDays className="size-3.5 shrink-0" style={{ color: "var(--muted-foreground-faint)" }} />
        {f.text}
      </div>
    );
  }

  // long-form text/tags/arrays → wrap in a block showing the full value.
  if (wide && !f.icon) {
    return <div className="text-[13px] whitespace-pre-wrap wrap-break-word rounded-md px-2.5 py-1.5">{fullText}</div>;
  }
  if (wide && f.icon) {
    // markdown is a block; tags/arrays are chip collections that should wrap.
    return cm.widget === "markdown" ? (
      <div className="text-[13px]">{f.icon}</div>
    ) : (
      <div className="text-[13px] flex flex-wrap gap-1">{f.icon}</div>
    );
  }

  // numeric → emphasized, aligned figures.
  if (NUMERIC_WIDGETS.has(cm.widget)) {
    return (
      <div
        className={`${emphasize ? "text-[15px]" : "text-[13.5px]"} font-medium tabular-nums truncate`}
        title={f.text}
      >
        {f.icon ?? f.text}
      </div>
    );
  }

  return (
    <div
      className={`${size} wrap-break-word ${emphasize ? "font-medium" : ""}`}
      style={{ color: f.muted ? "var(--muted-foreground-faint)" : "var(--foreground)" }}
    >
      {f.icon ?? fullText}
    </div>
  );
}

function FieldList({ meta, row, fkLabels }: { meta: TableMeta; row: Record<string, unknown>; fkLabels: FkLabels }) {
  const cols = meta.columns.filter((c) => !c.hidden && c.widget !== "html");
  // key/identifying fields (display column + primary key) surface first with a
  // heavier treatment; grid's default stretch keeps the two columns' bottom
  // borders aligned per row, giving clean dividers.
  const keyNames = new Set([meta.displayColumn, ...effectiveKey(meta.table)].filter(Boolean) as string[]);
  const ordered = [...cols].sort((a, b) => Number(keyNames.has(b.col.name)) - Number(keyNames.has(a.col.name)));
  return (
    <div className="grid grid-cols-2 gap-x-6">
      {ordered.map((cm) => {
        const v = row[cm.col.name];
        const label = cm.ref && v != null ? fkLabelFor(fkLabels, cm.col.name, row) : undefined;
        const isMedia =
          (cm.widget === "image" || cm.widget === "video" || cm.widget === "audio") &&
          typeof v === "string" &&
          v !== "";
        // wide fields claim a full row; a plain long string does too, so it
        // isn't clipped mid-word in a half-width cell. json is always wide
        // (via WIDE_WIDGETS) even though its preview text is short — matches
        // the other "big value" widgets (markdown/textarea/tag/array).
        const f = formatCell(v, cm.widget, cm.optionLabels);
        const wide =
          !label &&
          !isMedia &&
          (WIDE_WIDGETS.has(cm.widget) || (!f.icon && v != null && typeof v !== "boolean" && f.text.length > 64));
        const isKey = keyNames.has(cm.col.name);
        const Icon = cm.ref ? Link2 : widgetIcons[cm.widget];
        // An object (json/jsonb's parsed shape) needs stringifying — plain
        // String(v) on an object gives "[object Object]", not useful to copy.
        const copyText =
          v == null ? "" : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
        return (
          <div
            key={cm.col.name}
            className={`group min-w-0 border-b py-2.5 ${wide ? "col-span-2" : ""}`}
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide mb-1"
              style={{ color: isKey ? "var(--foreground)" : "var(--muted-foreground-faint)" }}
            >
              <Icon className="size-3 shrink-0" />
              <span className="truncate">{cm.label}</span>
              {isKey && (
                <span className="tag code" style={{ fontSize: 9 }}>
                  key
                </span>
              )}
              {(copyText || cm.widget === "json") && (
                <span className="ml-auto flex items-center gap-0.5">
                  {cm.widget === "json" && v != null && <JsonExpandButton cm={cm} value={v} />}
                  {copyText && <CopyButton text={copyText} />}
                </span>
              )}
            </div>
            <FieldValue cm={cm} value={v} label={label} isMedia={isMedia} wide={wide} emphasize={isKey} />
          </div>
        );
      })}
    </div>
  );
}

// dedicated full-width card per HTML column — renders the markup in a Shadow
// DOM (isolates its styles from the app) with inline source editing.
function HtmlCard({
  meta,
  row,
  pk,
  column,
}: {
  meta: TableMeta;
  row: Record<string, unknown>;
  pk: Record<string, unknown>;
  column: string;
}) {
  const qc = useQueryClient();
  const stored = row[column];
  const value = typeof stored === "string" ? stored : stored == null ? "" : String(stored);
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(false);
  const [text, setText] = useState(value);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        dataApiUrl({ connection: meta.connection, table: meta.table.name, path: "row", schema: meta.schema }),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pk, data: { [column]: text === "" ? null : text } }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
    },
    onSuccess: () => {
      setEditing(false);
      setErr(null);
      qc.invalidateQueries({ queryKey: ["record"] });
      qc.invalidateQueries({
        queryKey: ["rows", meta.connection, meta.schema, meta.table.name],
      });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const cm = meta.columns.find((c) => c.col.name === column);
  return (
    <RelatedCard
      title={cm?.label ?? humanize(column)}
      subtitle="html"
      menu={[
        ...(value ? [{ label: raw ? "Show rendered" : "Show HTML source", onClick: () => setRaw((r) => !r) }] : []),
        ...(meta.isView
          ? []
          : [
              editing
                ? {
                    label: "Cancel editing",
                    onClick: () => {
                      setEditing(false);
                      setText(value);
                      setErr(null);
                    },
                  }
                : {
                    label: "✎ Edit HTML",
                    onClick: () => {
                      setText(value);
                      setEditing(true);
                    },
                  },
            ]),
      ]}
    >
      {editing ? (
        <>
          <Textarea className="code w-full" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
          {err && (
            <p className="text-[12px] mt-1" style={{ color: "var(--destructive)" }}>
              {err}
            </p>
          )}
          <Button size="sm" className="mt-2" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save HTML"}
          </Button>
        </>
      ) : !value ? (
        <NullValue className="text-[13px]" />
      ) : raw ? (
        <pre
          className="code text-[12px] whitespace-pre-wrap max-h-96 overflow-auto scrollbar-thin"
          style={{ color: "var(--foreground)" }}
        >
          {value}
        </pre>
      ) : (
        <ShadowDom html={value} className="block max-h-96 overflow-auto scrollbar-thin" />
      )}
    </RelatedCard>
  );
}

// parent record card (this row's FK → referenced row), incl. cross-database
function BelongsToCard({
  title,
  target,
  value,
}: {
  title: string;
  target: {
    connection: string;
    schema: string | undefined;
    table: string;
    column: string;
  };
  value: unknown;
}) {
  const { meta: targetMeta } = useTableMeta(target.connection, target.schema, target.table);
  const [editing, setEditing] = useState(false);
  const pkJson = JSON.stringify({ [target.column]: value });
  const { data, error } = useQuery<{
    row: Record<string, unknown>;
    fkLabels: FkLabels;
  }>({
    queryKey: ["record", target.connection, target.schema, target.table, String(value)],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection: target.connection,
          table: target.table,
          path: "row",
          schema: target.schema,
          params: { pk: pkJson },
        }),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "not found");
      return body;
    },
    enabled: value != null && !!targetMeta,
  });

  const href = recordHref({
    connection: target.connection,
    schema: target.schema,
    table: target.table,
    params: { pk: pkJson },
  });
  return (
    <RelatedCard
      title={title}
      subtitle={[target.connection, target.schema, target.table].filter(Boolean).join(".")}
      menu={[
        ...(data && targetMeta && !targetMeta.isView
          ? [{ label: "✎ Edit record", onClick: () => setEditing(true) }]
          : []),
        { label: "Open record →", href },
        {
          label: "Open table",
          href: tableHref({ connection: target.connection, schema: target.schema, table: target.table }),
        },
      ]}
    >
      {value == null ? (
        <NullValue className="text-[13px]">∅ not linked</NullValue>
      ) : error ? (
        <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
          {(error as Error).message}
        </p>
      ) : !data || !targetMeta ? (
        <div className="h-16 rounded animate-pulse" style={{ background: "var(--border)" }} />
      ) : (
        <FieldList meta={targetMeta} row={data.row} fkLabels={data.fkLabels} />
      )}
      {editing && data && targetMeta && (
        <RowEditor meta={targetMeta} row={data.row} onClose={() => setEditing(false)} />
      )}
    </RelatedCard>
  );
}

// child rows card (other table's FK → this row), incl. cross-database
function HasManyCard({
  source,
  fkColumn,
  value,
}: {
  source: {
    connection: string;
    schema: string | undefined;
    table: string;
    sourceConstants?: { toColumn: string; value: string }[];
  };
  fkColumn: string;
  value: unknown;
}) {
  const { meta } = useTableMeta(source.connection, source.schema, source.table);
  const router = useRouter();
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
  const [sort, setSort] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const { data, error } = useQuery<{
    rows: Record<string, unknown>[];
    total: number | null;
    fkLabels: FkLabels;
  }>({
    queryKey: [
      "related",
      source.connection,
      source.schema,
      source.table,
      fkColumn,
      String(value),
      JSON.stringify(source.sourceConstants || []),
    ],
    queryFn: async () => {
      const filters = JSON.stringify([
        { column: fkColumn, op: "eq", value: String(value) },
        ...(source.sourceConstants || []).map((c) => ({
          column: c.toColumn,
          op: "eq",
          value: c.value,
        })),
      ]);
      const res = await fetch(
        dataApiUrl({
          connection: source.connection,
          table: source.table,
          schema: source.schema,
          params: { page: "0", pageSize: "8", filters },
        }),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");
      return body;
    },
    enabled: value != null && !!meta,
  });

  if (!meta) return null;
  const cols = meta.columns.filter((c) => !c.hidden && c.col.name !== fkColumn);
  return (
    <RelatedCard
      title={meta.label}
      subtitle={`${[source.connection, source.schema, source.table].filter(Boolean).join(".")} · via ${fkColumn}`}
      menu={[
        {
          label: "Open table",
          href: tableHref({ connection: source.connection, schema: source.schema, table: source.table }),
        },
      ]}
    >
      {error ? (
        <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
          {(error as Error).message}
        </p>
      ) : !data ? (
        <div className="h-16 rounded animate-pulse" style={{ background: "var(--border)" }} />
      ) : data.rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--muted-foreground-faint)" }}>
          No related rows.
        </p>
      ) : (
        <>
          <DataGrid
            columns={cols}
            rows={data.rows}
            fkLabels={data.fkLabels}
            sort={sort}
            sortDir={sortDir}
            onToggleSort={(col) => {
              if (sort === col) {
                if (sortDir === "asc") setSortDir("desc");
                else {
                  setSort(undefined);
                  setSortDir("asc");
                }
              } else {
                setSort(col);
                setSortDir("asc");
              }
            }}
            rowClickable={!meta.isView}
            onRowClick={(row) => {
              if (meta.isView) return;
              const pkObj: Record<string, unknown> = {};
              for (const k of effectiveKey(meta.table)) pkObj[k] = row[k];
              router.push(
                recordHref({
                  connection: source.connection,
                  schema: source.schema,
                  table: source.table,
                  params: { pk: JSON.stringify(pkObj) },
                }),
              );
            }}
            maxHeight="calc(100vh - 400px)"
          />
          {data.total != null && data.total > data.rows.length && (
            <p className="text-[12px] mt-1.5" style={{ color: "var(--muted-foreground-faint)" }}>
              showing {data.rows.length} of {data.total}
            </p>
          )}
        </>
      )}
      {editingRow && <RowEditor meta={meta} row={editingRow} onClose={() => setEditingRow(null)} />}
    </RelatedCard>
  );
}

function RecordView() {
  const params = useParams<{
    connection: string;
    table: string;
  }>();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const schema = useSchemaParam();
  const { meta, catalog, schemaMeta } = useTableMeta(params.connection, schema, params.table);
  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const pk = useMemo(() => {
    try {
      // pk may be a direct param or embedded in the `query` param (as `pk=...`)
      // which is how recordHref encodes it via URLSearchParams({query}).
      const direct = search.get("pk");
      if (direct) return JSON.parse(direct) as Record<string, unknown>;
      const queryStr = search.get("query") ?? "";
      const inner = new URLSearchParams(queryStr).get("pk");
      return inner ? (JSON.parse(inner) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [search]);
  const { data, error } = useQuery<{
    row: Record<string, unknown>;
    fkLabels: FkLabels;
  }>({
    queryKey: ["record", params.connection, schema, params.table, JSON.stringify(pk)],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection: params.connection,
          table: params.table,
          path: "row",
          schema: meta?.schema,
          params: {
            pk: JSON.stringify(pk),
          },
        }),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "not found");
      return body;
    },
    enabled: !!meta && Object.keys(pk).length > 0,
  });

  // relations to render as cards. `schema` on each entry is already resolved
  // to string|undefined here (undefined when that entry's connection has no
  // real schema) — consumers (HasManyCard etc.) just use it, no engine checks.
  const relations = useMemo(() => {
    if (!catalog || !meta || !schemaMeta)
      return {
        belongsTo: [],
        hasMany: [] as {
          connection: string;
          schema: string | undefined;
          table: string;
          fkColumn: string;
          sourceConstants?: { toColumn: string; value: string }[];
        }[],
        manyToMany: [] as {
          connection: string;
          junctionSchema: string | undefined;
          junctionTable: string;
          selfFkColumn: string;
          otherFkColumn: string;
          otherSchema: string | undefined;
          otherTable: string;
        }[],
      };
    // Introspected FKs/virtual-FKs are matched against the always-resolved
    // schema; what we hand to the cards is the display one (undefined when
    // this engine has none) — same split as buildTableMeta.
    const concreteSchema = meta.resolvedSchema;
    const currentSchema = meta.schema;

    const belongsTo = meta.columns
      .filter((c) => c.ref)
      .map((c) => ({ title: c.label, column: c.col.name, target: c.ref! }));
    const manyToMany: {
      connection: string;
      junctionSchema: string | undefined;
      junctionTable: string;
      selfFkColumn: string;
      otherFkColumn: string;
      otherSchema: string | undefined;
      otherTable: string;
    }[] = [];
    const hasMany: {
      connection: string;
      schema: string | undefined;
      table: string;
      fkColumn: string;
      sourceConstants?: { toColumn: string; side?: "source" | "target"; value: string }[];
    }[] = [];
    // reverse real FKs — scan tables in the same schema (loaded on demand)
    if (schemaMeta?.tables) {
      for (const t of schemaMeta.tables) {
        for (const fk of t.foreignKeys) {
          if (
            fk.referencedSchema === concreteSchema &&
            fk.referencedTable === params.table &&
            fk.columns.length === 1 &&
            !(t.name === params.table)
          ) {
            hasMany.push({
              connection: params.connection,
              schema: currentSchema,
              table: t.name,
              fkColumn: fk.columns[0],
            });
            // Phase 8.5 — a junction table: `t` has this FK back to us plus
            // another single-column FK to a different table → M2M.
            const otherFk = t.foreignKeys.find(
              (f) =>
                f !== fk &&
                f.columns.length === 1 &&
                !(f.referencedSchema === concreteSchema && f.referencedTable === params.table),
            );
            if (otherFk) {
              manyToMany.push({
                connection: params.connection,
                junctionSchema: currentSchema,
                junctionTable: t.name,
                selfFkColumn: fk.columns[0],
                otherFkColumn: otherFk.columns[0],
                otherSchema: currentSchema,
                otherTable: otherFk.referencedTable,
              });
            }
          }
        }
      }
    }
    // reverse virtual FKs (any connection → this table). fromConnection/
    // toConnection store connection ids now, not names — resolve to the
    // name every downstream consumer (routing, connectionSupportsSchemas)
    // still expects.
    const connectionNameById = new Map(catalog.connections.map((c) => [c.connectionId, c.connectionName]));
    const thisConnectionId = catalog.connections.find((c) => c.connectionName === params.connection)?.connectionId;
    for (const v of schemaMeta.virtualFks) {
      if (v.toConnection !== thisConnectionId || v.toTable !== params.table) continue;
      // $schema resolves to the record's own schema; else must match literally
      const targetSchemaMatches = v.toSchema === SAME_SCHEMA || v.toSchema === concreteSchema;
      if (!targetSchemaMatches) continue;
      const fromSchema = v.toSchema === SAME_SCHEMA ? concreteSchema : v.fromSchema;
      const fkColumn = vfkDisplayColumn(v);
      // can't enumerate a concrete back-link when the source side is a pattern
      if (!fkColumn || isPattern(fromSchema) || isPattern(v.fromTable)) continue;
      const fromConnectionName = connectionNameById.get(v.fromConnection);
      if (!fromConnectionName) continue;
      hasMany.push({
        connection: fromConnectionName,
        schema: connectionSupportsSchemas(catalog, fromConnectionName) ? fromSchema : undefined,
        table: v.fromTable,
        fkColumn,
        sourceConstants: v.constants.filter((c) => c.side === "source"),
      });
    }
    return { belongsTo, hasMany, manyToMany };
  }, [catalog, meta, schemaMeta, params]);

  if (!catalog || !meta || !schemaMeta)
    return (
      <div className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
        Loading…
      </div>
    );
  if (error)
    return (
      <div className="text-[13px]" style={{ color: "var(--destructive)" }}>
        {(error as Error).message}
      </div>
    );

  const row = data?.row;
  const htmlColumns = meta.columns.filter((c) => c.widget === "html" && !c.hidden);
  const pkText = Object.entries(pk)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  // the value other tables' FKs point at (single-column key case)
  const recordKey = effectiveKey(meta.table);
  const pkValue = recordKey.length === 1 ? pk[recordKey[0]] : null;

  return (
    <div className="max-w-6xl">
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: "Home", link: "/" },
          { label: params.connection, link: `/browse/${params.connection}` },
          {
            label: meta.label,
            link: tableHref({ connection: params.connection, schema: meta.schema, table: params.table }),
          },
          { label: meta.displayColumn && row ? String(row[meta.displayColumn] ?? pkText) : pkText },
        ]}
      />

      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-lg font-semibold">
          {meta.displayColumn && row ? String(row[meta.displayColumn] ?? pkText) : pkText}
        </h1>
        <span className="tag code">{pkText}</span>
        <span className="flex-1" />
        {!meta.isView && (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              ✎ Edit
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirm("Delete this record?")) return;
                const res = await fetch(
                  dataApiUrl({ connection: params.connection, table: params.table, path: "row", schema: meta.schema }),
                  {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pk }),
                  },
                );
                if (res.ok) {
                  qc.invalidateQueries({
                    queryKey: ["rows", params.connection, schema, params.table],
                  });
                  router.push(tableHref({ connection: params.connection, schema: meta.schema, table: params.table }));
                }
              }}
            >
              Delete
            </Button>
          </>
        )}
      </div>

      {!row ? (
        <div className="grid grid-cols-2 gap-4">
          {/* main details card */}
          <Card className="col-span-2 p-4">
            <div className="h-3.5 w-28 rounded animate-pulse mb-4" style={{ background: "var(--input)" }} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {[55, 40, 70, 35, 60, 45, 65, 50].map((w, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="h-2.5 rounded animate-pulse" style={{ background: "var(--border)", width: "38%" }} />
                  <div
                    className="h-3.5 rounded animate-pulse"
                    style={{
                      background: "var(--input)",
                      width: `${w}%`,
                    }}
                  />
                </div>
              ))}
            </div>
          </Card>
          {/* relation card stubs */}
          {[68, 52].map((w, i) => (
            <Card key={i} className="p-4">
              <div
                className="h-3.5 rounded animate-pulse mb-3"
                style={{ background: "var(--input)", width: `${w}%` }}
              />
              <div className="flex flex-col gap-2">
                {[80, 60, 70].map((fw, fi) => (
                  <div
                    key={fi}
                    className="h-3 rounded animate-pulse"
                    style={{ background: "var(--border)", width: `${fw}%` }}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <RelatedCard
              title="Details"
              subtitle={[params.connection, schema, params.table].filter(Boolean).join(".")}
              menu={
                meta.isView
                  ? []
                  : [
                      {
                        label: "✎ Edit record",
                        onClick: () => setEditing(true),
                      },
                      {
                        label: "⧉ Duplicate",
                        onClick: () => setDuplicating(true),
                      },
                    ]
              }
            >
              <FieldList meta={meta} row={row} fkLabels={data!.fkLabels} />
            </RelatedCard>
          </div>

          {htmlColumns.map((c) => (
            <div key={c.col.name} className="col-span-2">
              <HtmlCard meta={meta} row={row} pk={pk} column={c.col.name} />
            </div>
          ))}

          {relations.belongsTo.map((b) => (
            <BelongsToCard key={b.column} title={b.title} target={b.target} value={row[b.column]} />
          ))}

          {pkValue != null &&
            relations.hasMany.map((h) => (
              <HasManyCard
                key={`${h.connection}.${h.schema}.${h.table}.${h.fkColumn}`}
                source={h}
                fkColumn={h.fkColumn}
                value={pkValue}
              />
            ))}

          {pkValue != null &&
            relations.manyToMany.map((m) => (
              <LinkedRecordsCard
                key={`${m.junctionSchema}.${m.junctionTable}.${m.selfFkColumn}.${m.otherFkColumn}`}
                title={humanize(m.otherTable)}
                target={m}
                selfValue={pkValue}
              />
            ))}

          {Object.keys(pk).length > 0 && (
            <div className="col-span-2">
              <RecordComments
                connectionId={meta.connectionId}
                schema={meta.resolvedSchema}
                table={params.table}
                pk={pk}
              />
            </div>
          )}
        </div>
      )}

      {editing && row && <RowEditor meta={meta} row={row} onClose={() => setEditing(false)} />}
      {duplicating && row && (
        <RowEditor meta={meta} row={null} duplicateFrom={row} onClose={() => setDuplicating(false)} />
      )}
    </div>
  );
}

export default function RecordPage() {
  return (
    <Suspense
      fallback={
        <div className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </div>
      }
    >
      <RecordView />
    </Suspense>
  );
}
