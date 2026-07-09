"use client";

// Right-side drawer with an auto-generated form for creating/editing a row.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TableMeta, ColumnMeta } from "./useTableMeta";
import { ReferencePickerModal } from "./reference-picker-modal";
import { RedactedValue } from "./redacted-value";
import { Button } from "@/components/ui/button";
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
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  // remember the label for whatever value is currently set, so it reads as
  // "label (id)" even when the dropdown is closed and the row was pre-loaded.
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const ref = cm.ref!;

  const schemaParam = ref.schema ? `schema=${encodeURIComponent(ref.schema)}&` : "";

  const { data: options } = useQuery<{ id: string; label: string }[]>({
    queryKey: ["refs", ref.connection, ref.schema, ref.table, ref.column, search],
    queryFn: async () => {
      const res = await fetch(
        `/api/data/${ref.connection}/${ref.table}/refs?${schemaParam}column=${encodeURIComponent(ref.column)}&q=${encodeURIComponent(search)}`,
      );
      if (!res.ok) throw new Error("refs failed");
      return res.json();
    },
    enabled: open,
  });

  // resolve the label of the current value once (exact id lookup) for display
  useQuery<{ id: string; label: string }[]>({
    queryKey: ["ref-label", ref.connection, ref.schema, ref.table, ref.column, value],
    queryFn: async () => {
      const res = await fetch(
        `/api/data/${ref.connection}/${ref.table}/refs?${schemaParam}column=${encodeURIComponent(ref.column)}&q=${encodeURIComponent(value)}`,
      );
      const body = await res.json();
      if (res.ok) {
        const hit = (body as { id: string; label: string }[]).find((o) => o.id === value);
        if (hit) setPickedLabel(hit.label);
      }
      return body;
    },
    enabled: !!value && pickedLabel === null,
  });

  const selected = options?.find((o) => o.id === value);
  const displayLabel = selected?.label ?? pickedLabel;

  const pick = (id: string, label: string | null) => {
    onChange(id);
    setPickedLabel(label);
    setOpen(false);
  };

  return (
    <>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <input
            className="input"
            placeholder={`Search ${ref.table}…`}
            value={open ? search : displayLabel ? `${displayLabel} (${value})` : value}
            onFocus={() => {
              setOpen(true);
              setSearch("");
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => setSearch(e.target.value)}
          />
          {open && (
            <div
              className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border scrollbar-thin"
              style={{
                background: "var(--muted)",
                borderColor: "var(--input)",
              }}
            >
              {cm.col.nullable && (
                <Button
                  variant="ghost"
                  className="block w-full text-left px-3 py-1.5 text-[13px] hoverable"
                  type="button"
                  style={{ color: "var(--muted-foreground-faint)" }}
                  onMouseDown={() => pick("", null)}
                >
                  ∅ null
                </Button>
              )}
              {options?.map((o) => (
                <Button
                  variant="ghost"
                  className="block w-full text-left px-3 py-1.5 text-[13px] hoverable"
                  type="button"
                  key={o.id}
                  onMouseDown={() => pick(o.id, o.label)}
                >
                  {o.label} <span style={{ color: "var(--muted-foreground-faint)" }}>({o.id})</span>
                </Button>
              ))}
              {options?.length === 0 && (
                <div className="px-3 py-2 text-[12px]" style={{ color: "var(--muted-foreground-faint)" }}>
                  No matches — try Browse
                </div>
              )}
            </div>
          )}
        </div>
        <Button
          variant="outline"
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
          onPick={(id, label) => pick(id, label)}
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
    <div className="input flex flex-wrap items-center gap-1 h-auto min-h-8 py-1">
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
  const editable = meta.columns.filter((c) => !c.col.isGenerated);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const source = row ?? duplicateFrom ?? null;
    const init: Record<string, string> = {};
    for (const cm of editable) {
      // when duplicating, clear PK columns so the DB assigns new ones
      const clear = !!duplicateFrom && !row && meta.table.primaryKey.includes(cm.col.name);
      init[cm.col.name] = source && !clear ? toInputValue(cm, source[cm.col.name]) : "";
    }
    setValues(init);
    // duplicated fields count as user-entered so create sends them all
    setTouched(duplicateFrom && !row ? new Set(Object.keys(init)) : new Set());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, duplicateFrom, meta.table.name]);

  const pk = useMemo(() => {
    if (!row) return null;
    const obj: Record<string, unknown> = {};
    for (const k of meta.table.primaryKey) obj[k] = row[k];
    return obj;
  }, [row, meta.table.primaryKey]);

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
      const base = `/api/data/${meta.connection}/${meta.table.name}`;
      const query = meta.schema ? `?schema=${encodeURIComponent(meta.schema)}` : "";
      const res = isCreate
        ? await fetch(`${base}${query}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          })
        : await fetch(`${base}/row${query}`, {
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
      const query = meta.schema ? `?schema=${encodeURIComponent(meta.schema)}` : "";
      const res = await fetch(`/api/data/${meta.connection}/${meta.table.name}/row${query}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pk }),
      });
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
                  <div className="input opacity-60 code" style={{ minHeight: 32 }}>
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
                  <select className="input" value={v} onChange={(e) => setVal(name, e.target.value)}>
                    <option value="">{cm.col.nullable ? "∅ null" : "— pick —"}</option>
                    {cm.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : cm.widget === "toggle" ? (
                  <select className="input" value={v} onChange={(e) => setVal(name, e.target.value)}>
                    {cm.col.nullable && <option value="">∅ null</option>}
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : cm.widget === "array" ? (
                  <ChipInput value={v} onChange={(nv) => setVal(name, nv)} />
                ) : cm.widget === "uuid" ? (
                  <div className="flex gap-1.5">
                    <input
                      className="input code"
                      value={v}
                      placeholder="uuid"
                      onChange={(e) => setVal(name, e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      title="Generate a random UUID"
                      onClick={() => setVal(name, crypto.randomUUID())}
                    >
                      ⟳
                    </Button>
                  </div>
                ) : cm.widget === "bytea" ? (
                  <div className="input opacity-70 code flex items-center" style={{ minHeight: 32 }}>
                    {row ? toInputValue(cm, row[name]) || "∅" : "∅"}
                    <span className="ml-2" style={{ color: "var(--muted-foreground-faint)", fontSize: 11 }}>
                      binary — not editable here
                    </span>
                  </div>
                ) : cm.widget === "textarea" || cm.widget === "json" ? (
                  <textarea
                    className={`input ${cm.widget === "json" ? "code" : ""}`}
                    rows={cm.widget === "json" ? 5 : 3}
                    value={v}
                    onChange={(e) => setVal(name, e.target.value)}
                  />
                ) : (
                  <input
                    className="input"
                    type={
                      cm.redacted
                        ? "password"
                        : cm.widget === "number"
                          ? "number"
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
