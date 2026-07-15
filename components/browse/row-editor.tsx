"use client";

// Right-side drawer with an auto-generated form for creating/editing a row.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TableMeta, ColumnMeta } from "./useTableMeta";
import { effectiveKey, NUMERIC_UDTS } from "@/lib/introspect/heuristics";
import { toBoolean, getLocalCurrency, getCurrencySymbol, type Widget } from "@/lib/data/widgets";
import { dataApiUrl } from "./data-api";
import { useFreshRow } from "./use-fresh-row";
import { ReferencePickerModal } from "./reference-picker-modal";
import { RefCombobox } from "./ref-combobox";
import { TagInput } from "./tag-input";
import { AutocompleteInput } from "./autocomplete-input";
import { RedactedValue } from "./redacted-value";
import { RedactedInput } from "./redacted-input";
import { MediaPreview, type MediaKind } from "./media-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { ToggleInput } from "@/components/ui/toggle-input";
import { Textarea } from "@/components/ui/textarea";
import { DataSelect } from "@/components/ui/data-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Rating } from "@/components/ui/rating";
import { marked } from "marked";
import { Loader2 } from "lucide-react";
import { AvatarCell } from "./avatar-cell";
import { TimezoneCell } from "./timezone-cell";
import { tzOptions } from "@/lib/data/timezones";

interface Props {
  meta: TableMeta;
  row: Record<string, unknown> | null; // null = create
  // Phase 8.2: seed a *create* form from an existing row (duplicate). PK
  // columns are cleared so the DB assigns fresh keys.
  duplicateFrom?: Record<string, unknown> | null;
  refetchOnOpen?: boolean;
  onClose: () => void;
}

// Widgets whose content needs more than half the dialog's width (long-form
// text, chip lists, media previews) — everything else pairs up two-per-row
// in the field grid below.
const WIDE_WIDGETS = new Set<Widget>([
  "textarea",
  "json",
  "html",
  "markdown",
  "array",
  "tag",
  "image",
  "video",
  "audio",
  "bytea",
]);

function toInputValue(cm: ColumnMeta, v: unknown): string | string[] {
  if (v === null || v === undefined) return cm.widget === "tag" ? [] : "";
  // ToggleInput's value is matched against the literal strings "true"/
  // "false" — trust the widget rather than `String(v)`, or a MySQL
  // tinyint(1) column (raw 0/1) would leave an existing row's toggle
  // unselected on edit.
  if (cm.widget === "toggle") return toBoolean(v) ? "true" : "false";
  if (cm.widget === "json") return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  // "array" editor state is held as a JSON string of the element list
  // (ChipInput's convention). "tag" is kept as a real string[] end to end —
  // the server already normalizes it to an array on every read (see
  // normalizeTagColumns in app/api/data/crud.ts), and TagInput's Combobox needs
  // the real array, not a serialized form of it.
  if (cm.widget === "array") return JSON.stringify(Array.isArray(v) ? v : []);
  if (cm.widget === "tag") return Array.isArray(v) ? v.map(String) : [];
  if (cm.widget === "bytea") {
    const b = v as { type?: string; data?: unknown[] };
    if (b && b.type === "Buffer" && Array.isArray(b.data)) return `⬇ ${b.data.length} bytes`;
    return "";
  }
  if (cm.widget === "datetime" && typeof v === "string") {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if (m) return `${m[1]}T${m[2]}`;
  }
  if (cm.widget === "date" && typeof v === "string") return v.slice(0, 10);
  return String(v);
}

function ReferenceInput({ cm, value, onChange }: { cm: ColumnMeta; value: string; onChange: (v: string) => void }) {
  const [browsing, setBrowsing] = useState(false);
  const ref = cm.ref!;

  return (
    <>
      <div className="flex gap-1.5">
        <RefCombobox
          target={ref}
          value={value}
          nullable={cm.col.nullable}
          className="flex-1"
          onSelect={(id) => onChange(id)}
        />
        <Button
          variant="secondary"
          type="button"
          title={`Browse ${ref.table} in a full table with filters`}
          onClick={() => setBrowsing(true)}
        >
          ⤢
        </Button>
      </div>
      {browsing && (
        <ReferencePickerModal
          target={ref}
          title={cm.label}
          onPick={(id) => onChange(id)}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  );
}

// Tag/chip editor for array columns. Value is a JSON string of the element
// list; elements are edited as text (Postgres coerces them to the element type
// on write). Add with Enter or comma, remove with the chip's ✕.
function ChipInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  let items: string[] = [];
  try {
    const parsed = value ? JSON.parse(value) : [];
    if (Array.isArray(parsed)) items = parsed.map((x) => String(x));
  } catch {
    /* treat as empty */
  }
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const next = raw.trim();
    if (!next) return;
    onChange(JSON.stringify([...items, next]));
    setDraft("");
  };
  return (
    <div className="flex h-auto min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-card py-1 px-2.5">
      {items.map((it, i) => (
        <span key={i} className="tag flex items-center gap-1" style={{ fontSize: 11.5 }}>
          {it}
          <button
            type="button"
            onClick={() => onChange(JSON.stringify(items.filter((_, j) => j !== i)))}
            style={{ color: "var(--muted-foreground-faint)" }}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-16 bg-transparent outline-none text-[13px]"
        placeholder={items.length ? "" : "add value…"}
        value={draft}
        onChange={(e) => {
          if (e.target.value.endsWith(",")) commit(e.target.value.slice(0, -1));
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && items.length) {
            onChange(JSON.stringify(items.slice(0, -1)));
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

export function RowEditor({ meta, row: initialRow, duplicateFrom, refetchOnOpen, onClose }: Props) {
  const qc = useQueryClient();
  const rowKeyCols = effectiveKey(meta.table);
  const initialPk = useMemo(() => {
    if (!initialRow) return null;
    const obj: Record<string, unknown> = {};
    for (const k of rowKeyCols) obj[k] = initialRow[k];
    return obj;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRow, rowKeyCols.join(",")]);

  const {
    data: freshRow,
    error: freshRowError,
    isFetching: freshRowLoading,
  } = useFreshRow(meta.connection, meta.schema, meta.table.name, initialPk, !!refetchOnOpen);

  // Render immediately with whatever the caller already had — the refetch
  // (see use-fresh-row.ts) just upgrades it in place once it lands, rather
  // than blocking the whole form behind a spinner.
  const row = refetchOnOpen ? (freshRow ?? initialRow) : initialRow;
  const isCreate = row === null;
  const editable = meta.columns;
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  // Lets the seeding effect below see the latest `touched` without also
  // re-running every time the user types (it only depends on `row`).
  const touchedRef = useRef<Set<string>>(touched);
  useEffect(() => {
    touchedRef.current = touched;
  }, [touched]);

  useEffect(() => {
    // This also fires when the background refetch (refetchOnOpen) upgrades
    // `row` from the caller's possibly-stale/partial copy to the freshly
    // fetched one — skip re-seeding once the user has actually started
    // editing, so a slow network can't yank back an in-progress edit.
    if (touchedRef.current.size > 0) return;
    const source = row ?? duplicateFrom ?? null;
    const init: Record<string, string | string[]> = {};
    for (const cm of editable) {
      // when duplicating, clear key columns so the DB assigns new ones
      const clear = !!duplicateFrom && !row && effectiveKey(meta.table).includes(cm.col.name);
      init[cm.col.name] = source && !clear ? toInputValue(cm, source[cm.col.name]) : cm.widget === "tag" ? [] : "";
    }
    setValues(init);
    // duplicated fields count as user-entered so create sends them all
    setTouched(duplicateFrom && !row ? new Set(Object.keys(init)) : new Set());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, duplicateFrom, meta.table.name]);

  const rowKey = effectiveKey(meta.table);
  const pk = useMemo(() => {
    if (!row) return null;
    const obj: Record<string, unknown> = {};
    for (const k of rowKey) obj[k] = row[k];
    return obj;
  }, [row, rowKey]);

  const buildPayload = () => {
    const data: Record<string, unknown> = {};
    const errs: Record<string, string> = {};
    for (const cm of editable) {
      const name = cm.col.name;
      if (cm.readonly) continue;
      if (!isCreate && !touched.has(name)) continue; // only send changed fields on update
      const raw = values[name] ?? "";
      const isEmpty = Array.isArray(raw) ? raw.length === 0 : raw === "";
      // inline required-field validation (Phase 8.2) — catch NOT NULL with no
      // default before the round-trip instead of surfacing a DB 23502 error
      if (isEmpty && cm.required && cm.widget !== "toggle") {
        errs[name] = "Required";
        continue;
      }
      if (isEmpty && cm.widget !== "toggle") {
        if (isCreate && cm.col.default !== null) continue; // let the DB default apply
        data[name] = null;
        continue;
      }
      switch (cm.widget) {
        case "toggle":
          data[name] = raw === "true";
          break;
        case "number":
          data[name] = raw === "" ? null : Number(raw);
          break;
        case "json":
          try {
            data[name] = JSON.parse(raw as string);
          } catch {
            errs[name] = "Invalid JSON";
          }
          break;
        case "array": {
          // held as a JSON string of the element list; empty → null. Sent
          // as a real array — coerceValue (app/api/data/crud.ts) is what
          // decides whether the underlying column needs it stringified
          // (plain text/varchar) or can take it natively (json/jsonb, or a
          // real DB array type), same as the "json" widget.
          let arr: unknown[] = [];
          try {
            arr = raw ? JSON.parse(raw as string) : [];
          } catch {
            /* treat as empty */
          }
          data[name] = arr.length ? arr : null;
          break;
        }
        case "tag": {
          // held as a real string[] end to end (see toInputValue) — sent as
          // a real array, same coerceValue handoff as "array" above.
          const arr = Array.isArray(raw) ? raw : [];
          data[name] = arr.length ? arr : null;
          break;
        }
        case "bytea":
          // binary editing is not supported here; never send it back
          continue;
        case "autocomplete":
          // the editor is always a text combobox regardless of the
          // underlying column type (same display/typing as "text") — but a
          // numeric column needs a real number on write, same coercion as
          // the "number" widget above, or the value round-trips as text.
          data[name] = NUMERIC_UDTS.has(cm.col.udtName) ? Number(raw) : raw;
          break;
        default:
          data[name] = raw;
      }
    }
    setJsonErrors(errs);
    return Object.keys(errs).length ? null : data;
  };

  const save = useMutation({
    mutationFn: async () => {
      const data = buildPayload();
      if (!data) throw new Error("Fix the highlighted fields");
      const url = (path?: string) =>
        dataApiUrl({ connection: meta.connection, table: meta.table.name, path, schema: meta.schema });
      const res = isCreate
        ? await fetch(url(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          })
        : await fetch(url("row"), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pk,
              data,
              expectedUpdatedAt: meta.updatedAtColumn && row ? row[meta.updatedAtColumn] : undefined,
            }),
          });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["rows", meta.connection, meta.schema, meta.table.name],
      });
      qc.invalidateQueries({ queryKey: ["record"] });
      qc.invalidateQueries({ queryKey: ["related"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        dataApiUrl({ connection: meta.connection, table: meta.table.name, path: "row", schema: meta.schema }),
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pk }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["rows", meta.connection, meta.schema, meta.table.name],
      });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const setVal = (name: string, v: string | string[]) => {
    setValues((s) => ({ ...s, [name]: v }));
    setTouched((s) => new Set(s).add(name));
  };

  const [mdPreviewActive, setMdPreviewActive] = useState<Record<string, boolean>>({});

  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    setTimeout(onClose, 200);
  };

  if (refetchOnOpen && initialRow && freshRowError) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="top-[5vh] translate-y-0">
          <DialogHeader>
            <DialogTitle>Couldn&apos;t load this row</DialogTitle>
          </DialogHeader>
          <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
            {(freshRowError as Error).message || "It may have been deleted since you last saw it."}
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent
        className="top-[5vh] translate-y-0 flex flex-col gap-3 resize overflow-auto rounded-xl"
        style={{
          width: 880,
          height: "min(85vh, 900px)",
          minWidth: 480,
          minHeight: 320,
          maxWidth: "95vw",
          maxHeight: "95vh",
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCreate ? `New ${meta.label} row` : `Edit ${meta.label}`}
            {refetchOnOpen && freshRowLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-1 -mx-1">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {editable.map((cm) => {
              const name = cm.col.name;
              const raw = values[name] ?? "";
              const v = typeof raw === "string" ? raw : "";
              const disabled = cm.readonly;
              return (
                <div key={name} className={WIDE_WIDGETS.has(cm.widget) ? "col-span-2" : undefined}>
                  <label className="label">
                    {cm.label}
                    {cm.required && !disabled && <span style={{ color: "var(--destructive)" }}> *</span>}
                    <span className="ml-2 code" style={{ color: "var(--muted-foreground-faint)", fontSize: 10.5 }}>
                      {cm.col.udtName}
                    </span>
                  </label>
                  {disabled ? (
                    <div className="code flex min-h-8 w-full items-center rounded-lg border border-input bg-card px-2.5 py-1 opacity-60">
                      {cm.redacted ? (
                        <RedactedValue value={row?.[name]} />
                      ) : row ? (
                        toInputValue(cm, row[name]) || "∅"
                      ) : (
                        "(assigned by database)"
                      )}
                    </div>
                  ) : cm.ref ? (
                    <ReferenceInput cm={cm} value={v} onChange={(nv) => setVal(name, nv)} />
                  ) : cm.widget === "select" && cm.options ? (
                    <DataSelect
                      items={cm.options}
                      value={v || null}
                      onChange={(o) => setVal(name, o ?? "")}
                      getValue={(o) => o}
                      getLabel={(o) => cm.optionLabels?.[o] ?? o}
                      clearable
                      clearLabel={cm.col.nullable ? "∅ null" : "— pick —"}
                      className="w-full"
                    />
                  ) : cm.widget === "toggle" ? (
                    <ToggleInput
                      value={v === "true" ? true : v === "false" ? false : null}
                      onChange={(value) => setVal(name, value === null ? "" : String(value))}
                      clearable={cm.col.nullable}
                      clearLabel="∅ null"
                      className="w-full"
                    />
                  ) : cm.widget === "array" ? (
                    <ChipInput value={v} onChange={(nv) => setVal(name, nv)} />
                  ) : cm.widget === "uuid" ? (
                    <div className="flex gap-1.5">
                      <Input
                        className="code"
                        value={v}
                        placeholder="uuid"
                        onChange={(e) => setVal(name, e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        title="Generate a random UUID"
                        onClick={() => setVal(name, crypto.randomUUID())}
                      >
                        ⟳
                      </Button>
                    </div>
                  ) : cm.widget === "bytea" ? (
                    <div className="code flex min-h-8 w-full items-center rounded-lg border border-input bg-card px-2.5 py-1 opacity-70">
                      {row ? toInputValue(cm, row[name]) || "∅" : "∅"}
                      <span className="ml-2" style={{ color: "var(--muted-foreground-faint)", fontSize: 11 }}>
                        binary — not editable here
                      </span>
                    </div>
                  ) : cm.widget === "textarea" || cm.widget === "json" || cm.widget === "html" ? (
                    <Textarea
                      className={cm.widget === "json" || cm.widget === "html" ? "code" : undefined}
                      rows={cm.widget === "textarea" ? 3 : cm.widget === "html" ? 8 : 5}
                      value={v}
                      onChange={(e) => setVal(name, e.target.value)}
                    />
                  ) : cm.widget === "image" || cm.widget === "video" || cm.widget === "audio" ? (
                    <div>
                      <Input placeholder="URL" value={v} onChange={(e) => setVal(name, e.target.value)} />
                      {v && (
                        <MediaPreview
                          kind={cm.widget as MediaKind}
                          value={v}
                          className="mt-2 max-h-40 rounded border"
                        />
                      )}
                    </div>
                  ) : cm.widget === "number" && !cm.redacted ? (
                    <NumberInput
                      numeric={cm.col.numeric}
                      value={v === "" ? "" : Number(v)}
                      onChange={(value) => setVal(name, String(value))}
                    />
                  ) : cm.widget === "color" ? (
                    <div className="flex gap-2 items-center">
                      <Input
                        type="color"
                        className="w-10 h-10 p-0 border rounded cursor-pointer shrink-0"
                        value={v || "#000000"}
                        onChange={(e) => setVal(name, e.target.value)}
                      />
                      <Input
                        placeholder="#000000"
                        value={v}
                        onChange={(e) => setVal(name, e.target.value)}
                        className="font-mono flex-1"
                      />
                    </div>
                  ) : cm.widget === "percent" ? (
                    <div className="flex gap-3 items-center">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        className="flex-1 cursor-pointer accent-primary h-2 bg-muted rounded-lg appearance-none"
                        value={Number(v) || 0}
                        onChange={(e) => setVal(name, e.target.value)}
                      />
                      <div className="flex items-center gap-1 shrink-0 w-20">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={v}
                          onChange={(e) => setVal(name, e.target.value)}
                          className="w-16 text-right"
                        />
                        <span className="text-sm font-medium text-muted-foreground">%</span>
                      </div>
                    </div>
                  ) : cm.widget === "rating" ? (
                    <div className="flex items-center gap-2 py-1">
                      <Rating value={Number(v) || 0} onChange={(starValue) => setVal(name, String(starValue))} />
                      {(Number(v) || 0) > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                          onClick={() => setVal(name, "")}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  ) : cm.widget === "currency" ? (
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-muted-foreground select-none">
                        {getCurrencySymbol(getLocalCurrency())}
                      </span>
                      <Input
                        type="number"
                        className="pl-7"
                        placeholder="0.00"
                        value={v}
                        onChange={(e) => setVal(name, e.target.value)}
                      />
                    </div>
                  ) : cm.widget === "markdown" ? (
                    <div className="space-y-1.5 w-full">
                      <div className="flex items-center justify-between border-b pb-1 mb-1">
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold">Markdown</span>
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          onClick={() => setMdPreviewActive((s) => ({ ...s, [name]: !s[name] }))}
                        >
                          {mdPreviewActive[name] ? "Edit" : "Preview"}
                        </Button>
                      </div>
                      {mdPreviewActive[name] ? (
                        <div
                          className="p-2.5 rounded-lg border bg-muted/30 max-h-48 overflow-y-auto"
                          style={{ fontSize: "13px" }}
                          dangerouslySetInnerHTML={{
                            __html: String(marked.parse(v || "", { async: false })),
                          }}
                        />
                      ) : (
                        <Textarea
                          rows={4}
                          placeholder="Type markdown here..."
                          value={v}
                          onChange={(e) => setVal(name, e.target.value)}
                        />
                      )}
                    </div>
                  ) : cm.widget === "avatar" ? (
                    <div className="flex items-center gap-3 w-full">
                      <AvatarCell value={v} size="md" className="shrink-0 border shadow-sm" />
                      <Input
                        placeholder="e.g. Image URL or user name/initials"
                        value={v}
                        onChange={(e) => setVal(name, e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  ) : cm.widget === "timezone" ? (
                    <DataSelect
                      items={tzOptions}
                      value={tzOptions.find((o) => o.value === v) || null}
                      onChange={(opt) => setVal(name, opt?.value || "")}
                      placeholder="Select timezone..."
                      className="w-full"
                    />
                  ) : cm.widget === "tag" ? (
                    <TagInput
                      connection={meta.connection}
                      schema={meta.resolvedSchema}
                      table={meta.table.name}
                      column={name}
                      value={Array.isArray(raw) ? raw : []}
                      onChange={(arr) => setVal(name, arr)}
                    />
                  ) : cm.widget === "autocomplete" ? (
                    <AutocompleteInput
                      target={{
                        connection: meta.connection,
                        schema: meta.resolvedSchema,
                        table: meta.table.name,
                        column: name,
                      }}
                      value={v}
                      onChange={(val) => setVal(name, val)}
                    />
                  ) : cm.redacted ? (
                    <RedactedInput value={v} onChange={(nv) => setVal(name, nv)} />
                  ) : (
                    <Input
                      type={
                        cm.widget === "date"
                          ? "date"
                          : cm.widget === "datetime"
                            ? "datetime-local"
                            : cm.widget === "email"
                              ? "email"
                              : cm.widget === "url"
                                ? "url"
                                : "text"
                      }
                      placeholder={
                        cm.widget === "email" ? "user@example.com" : cm.widget === "url" ? "https://" : undefined
                      }
                      value={v}
                      onChange={(e) => setVal(name, e.target.value)}
                    />
                  )}
                  {jsonErrors[name] && (
                    <p className="text-[12px] mt-1" style={{ color: "var(--destructive)" }}>
                      {jsonErrors[name]}
                    </p>
                  )}
                  {cm.help && !jsonErrors[name] && (
                    <p className="text-[12px] mt-1" style={{ color: "var(--muted-foreground-faint)" }}>
                      {cm.help}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {error && (
          <p
            className="mt-4 text-[13px] rounded-md border px-3 py-2"
            style={{ color: "var(--destructive)", borderColor: "rgba(229,83,75,.4)" }}
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center gap-2">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : isCreate ? "Create row" : "Save changes"}
          </Button>
          {!isCreate && (
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() => confirm("Delete this row?") && del.mutate()}
            >
              Delete
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
