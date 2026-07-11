"use client";

// Right-side drawer with an auto-generated form for creating/editing a row.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TableMeta, ColumnMeta } from "./useTableMeta";
import { effectiveKey } from "@/lib/introspect/heuristics";
import { toBoolean } from "@/lib/data/widgets";
import { dataApiUrl } from "./data-api";
import { ReferencePickerModal } from "./reference-picker-modal";
import { RefCombobox } from "./ref-combobox";
import { RedactedValue } from "./redacted-value";
import { MediaPreview, type MediaKind } from "./media-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { ToggleInput } from "@/components/ui/toggle-input";
import { Textarea } from "@/components/ui/textarea";
import { DataSelect } from "@/components/ui/data-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Props {
  meta: TableMeta;
  row: Record<string, unknown> | null; // null = create
  // Phase 8.2: seed a *create* form from an existing row (duplicate). PK
  // columns are cleared so the DB assigns fresh keys.
  duplicateFrom?: Record<string, unknown> | null;
  onClose: () => void;
}

function toInputValue(cm: ColumnMeta, v: unknown): string {
  if (v === null || v === undefined) return "";
  // ToggleInput's value is matched against the literal strings "true"/
  // "false" — trust the widget rather than `String(v)`, or a MySQL
  // tinyint(1) column (raw 0/1) would leave an existing row's toggle
  // unselected on edit.
  if (cm.widget === "toggle") return toBoolean(v) ? "true" : "false";
  if (cm.widget === "json") return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  // array editor state is held as a JSON string of the element list
  if (cm.widget === "array") return JSON.stringify(Array.isArray(v) ? v : []);
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

export function RowEditor({ meta, row, duplicateFrom, onClose }: Props) {
  const qc = useQueryClient();
  const isCreate = row === null;
  const editable = meta.columns;
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const source = row ?? duplicateFrom ?? null;
    const init: Record<string, string> = {};
    for (const cm of editable) {
      // when duplicating, clear key columns so the DB assigns new ones
      const clear = !!duplicateFrom && !row && effectiveKey(meta.table).includes(cm.col.name);
      init[cm.col.name] = source && !clear ? toInputValue(cm, source[cm.col.name]) : "";
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
      // inline required-field validation (Phase 8.2) — catch NOT NULL with no
      // default before the round-trip instead of surfacing a DB 23502 error
      if (raw === "" && cm.required && cm.widget !== "toggle") {
        errs[name] = "Required";
        continue;
      }
      if (raw === "" && cm.widget !== "toggle") {
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
            data[name] = JSON.parse(raw);
          } catch {
            errs[name] = "Invalid JSON";
          }
          break;
        case "array": {
          // held as a JSON string of the element list; empty → null
          let arr: unknown[] = [];
          try {
            arr = raw ? JSON.parse(raw) : [];
          } catch {
            /* treat as empty */
          }
          data[name] = arr.length ? arr : null;
          break;
        }
        case "bytea":
          // binary editing is not supported here; never send it back
          continue;
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

  const setVal = (name: string, v: string) => {
    setValues((s) => ({ ...s, [name]: v }));
    setTouched((s) => new Set(s).add(name));
  };

  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    setTimeout(onClose, 200);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && close()}>
      <SheetContent side="right" className="w-150 max-w-full overflow-y-auto scrollbar-thin p-6">
        <SheetHeader className="mb-5">
          <SheetTitle>{isCreate ? `New ${meta.label} row` : `Edit ${meta.label}`}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {editable.map((cm) => {
            const name = cm.col.name;
            const v = values[name] ?? "";
            const disabled = cm.readonly;
            return (
              <div key={name}>
                <label className="label">
                  {cm.label}
                  {cm.required && !disabled && <span style={{ color: "var(--destructive)" }}> *</span>}
                  <span className="ml-2 code" style={{ color: "var(--muted-foreground-faint)", fontSize: 10.5 }}>
                    {cm.col.udtName}
                  </span>
                </label>
                {disabled ? (
                  <div
                    className="code flex min-h-8 w-full items-center rounded-lg border border-input bg-card px-2.5 py-1 opacity-60"
                  >
                    {cm.redacted ? (
                      <RedactedValue value={row?.[name]} />
                    ) : row ? (
                      toInputValue(cm, row[name]) || "∅"
                    ) : (
                      "(assigned by database)"
                    )}
                  </div>
                ) : cm.widget === "reference" && cm.ref ? (
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
                      <MediaPreview kind={cm.widget as MediaKind} value={v} className="mt-2 max-h-40 rounded border" />
                    )}
                  </div>
                ) : cm.widget === "number" && !cm.redacted ? (
                  <NumberInput
                    numeric={cm.col.numeric}
                    value={v === "" ? "" : Number(v)}
                    onChange={(value) => setVal(name, String(value))}
                  />
                ) : (
                  <Input
                    type={
                      cm.redacted
                        ? "password"
                        : cm.widget === "date"
                          ? "date"
                          : cm.widget === "datetime"
                            ? "datetime-local"
                            : "text"
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
      </SheetContent>
    </Sheet>
  );
}
