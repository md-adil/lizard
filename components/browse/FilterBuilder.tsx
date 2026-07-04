"use client";

// Advanced, type-aware filter builder for the table browser. A "Filter" button
// opens a popover: each condition picks a column, gets operators appropriate to
// that column's kind (text / number / date / boolean / enum / reference), and
// an adaptive value editor (search-select for references, multi-select for
// enums, chip lists for "in", two inputs for "between"). Conditions combine
// with a Match-all / Match-any toggle. Emits only complete conditions.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnMeta } from "./useTableMeta";
import type { FilterCondition, FilterOp, FilterSet, Combinator } from "@/lib/data/filters";
import { isComplete, NO_VALUE_OPS } from "@/lib/data/filters";

type Kind = "text" | "number" | "date" | "boolean" | "enum" | "reference";

function kindOf(cm: ColumnMeta): Kind {
  if (cm.ref) return "reference";
  if (cm.options && cm.options.length) return "enum";
  if (cm.col.udtName === "bool") return "boolean";
  if (cm.col.udtName === "date") return "date";
  if (cm.col.udtName.startsWith("timestamp")) return "date";
  if (["int2", "int4", "int8", "float4", "float8", "numeric", "money"].includes(cm.col.udtName)) return "number";
  return "text";
}

const OP_LABEL: Record<FilterOp, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  ncontains: "does not contain",
  startswith: "starts with",
  endswith: "ends with",
  gt: "greater than",
  gte: "≥",
  lt: "less than",
  lte: "≤",
  between: "between",
  in: "is any of",
  empty: "is empty",
  nempty: "is not empty",
  null: "is null",
  notnull: "is not null",
};

const OPS_BY_KIND: Record<Kind, FilterOp[]> = {
  text: ["contains", "ncontains", "eq", "neq", "startswith", "endswith", "in", "empty", "nempty", "null", "notnull"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "null", "notnull"],
  date: ["eq", "gt", "gte", "lt", "lte", "between", "null", "notnull"],
  boolean: ["eq", "null", "notnull"],
  enum: ["eq", "neq", "in", "null", "notnull"],
  reference: ["eq", "neq", "in", "null", "notnull"],
};

// friendlier labels for the date comparison ops
function opLabel(kind: Kind, op: FilterOp): string {
  if (kind === "date") {
    if (op === "gt") return "after";
    if (op === "lt") return "before";
    if (op === "gte") return "on or after";
    if (op === "lte") return "on or before";
  }
  return OP_LABEL[op];
}

// ---------- reference value search (id -> label) ----------

function useRefSearch(cm: ColumnMeta, search: string, enabled: boolean) {
  const ref = cm.ref!;
  return useQuery<{ id: string; label: string }[]>({
    queryKey: ["refs", ref.connection, ref.schema, ref.table, ref.column, search],
    queryFn: async () => {
      const res = await fetch(
        `/api/data/${ref.connection}/${ref.schema}/${ref.table}/refs?column=${encodeURIComponent(ref.column)}&q=${encodeURIComponent(search)}`
      );
      if (!res.ok) throw new Error("refs failed");
      return res.json();
    },
    enabled,
  });
}

function RefSelect({
  cm,
  onSelect,
}: {
  cm: ColumnMeta;
  onSelect: (id: string, label: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useRefSearch(cm, search, open);
  return (
    <div className="relative flex-1 min-w-[140px]">
      <input
        className="input"
        style={{ padding: "3px 8px", fontSize: 12 }}
        placeholder={`Search ${cm.ref!.table}…`}
        value={search}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setSearch(e.target.value)}
      />
      {open && (
        <div
          className="absolute z-30 mt-1 w-full max-h-52 overflow-auto rounded-md border scrollbar-thin"
          style={{ background: "var(--bg-raised)", borderColor: "var(--border-strong)" }}
        >
          {data?.map((o) => (
            <button
              key={o.id}
              type="button"
              className="block w-full text-left px-3 py-1.5 text-[12.5px] hoverable"
              onMouseDown={() => {
                onSelect(o.id, o.label);
                setSearch("");
              }}
            >
              {o.label} <span style={{ color: "var(--text-faint)" }}>({o.id})</span>
            </button>
          ))}
          {data?.length === 0 && (
            <div className="px-3 py-2 text-[12px]" style={{ color: "var(--text-faint)" }}>
              No matches
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- chips (for "in" value lists) ----------

function Chips({ values, labels, onRemove }: { values: string[]; labels?: Record<string, string>; onRemove: (v: string) => void }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-1">
      {values.map((v) => (
        <span key={v} className="tag" style={{ color: "var(--accent)" }}>
          {labels?.[v] ?? v}
          <button className="ml-1.5" onClick={() => onRemove(v)}>✕</button>
        </span>
      ))}
    </div>
  );
}

// ---------- one condition row ----------

function ConditionRow({
  columns,
  cond,
  onChange,
  onRemove,
}: {
  columns: ColumnMeta[];
  cond: FilterCondition;
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
}) {
  const cm = columns.find((c) => c.col.name === cond.column) ?? columns[0];
  const kind = kindOf(cm);
  const ops = OPS_BY_KIND[kind];
  const noValue = NO_VALUE_OPS.includes(cond.op);
  const dateType = cm.col.udtName.startsWith("timestamp") ? "datetime-local" : "date";
  const [chipDraft, setChipDraft] = useState("");
  // remembered labels for reference "in" chips
  const [refLabels, setRefLabels] = useState<Record<string, string>>({});

  const setCol = (name: string) => {
    const next = columns.find((c) => c.col.name === name)!;
    const nextKind = kindOf(next);
    const nextOp = OPS_BY_KIND[nextKind].includes(cond.op) ? cond.op : OPS_BY_KIND[nextKind][0];
    onChange({ column: name, op: nextOp, value: "", value2: "", values: [] });
  };

  const valueEditor = () => {
    if (noValue) return null;

    if (cond.op === "between") {
      const t = kind === "number" ? "number" : kind === "date" ? dateType : "text";
      return (
        <div className="flex items-center gap-1">
          <input
            className="input w-28"
            style={{ padding: "3px 8px", fontSize: 12 }}
            type={t}
            value={cond.value ?? ""}
            onChange={(e) => onChange({ ...cond, value: e.target.value })}
          />
          <span style={{ color: "var(--text-faint)" }}>and</span>
          <input
            className="input w-28"
            style={{ padding: "3px 8px", fontSize: 12 }}
            type={t}
            value={cond.value2 ?? ""}
            onChange={(e) => onChange({ ...cond, value2: e.target.value })}
          />
        </div>
      );
    }

    if (cond.op === "in") {
      const values = cond.values ?? [];
      // enum "in": checklist
      if (kind === "enum" && cm.options) {
        return (
          <div className="flex flex-wrap gap-1 max-w-[280px]">
            {cm.options.map((o) => {
              const on = values.includes(o);
              return (
                <button
                  key={o}
                  className="tag"
                  style={on ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}}
                  onClick={() =>
                    onChange({ ...cond, values: on ? values.filter((x) => x !== o) : [...values, o] })
                  }
                >
                  {o}
                </button>
              );
            })}
          </div>
        );
      }
      // reference "in": search + chips
      if (kind === "reference") {
        return (
          <div className="min-w-[180px]">
            <Chips values={values} labels={refLabels} onRemove={(v) => onChange({ ...cond, values: values.filter((x) => x !== v) })} />
            <RefSelect
              cm={cm}
              onSelect={(id, label) => {
                setRefLabels((m) => ({ ...m, [id]: label }));
                if (!values.includes(id)) onChange({ ...cond, values: [...values, id] });
              }}
            />
          </div>
        );
      }
      // text/number "in": type + Enter to add chips
      return (
        <div className="min-w-[160px]">
          <Chips values={values} onRemove={(v) => onChange({ ...cond, values: values.filter((x) => x !== v) })} />
          <input
            className="input"
            style={{ padding: "3px 8px", fontSize: 12 }}
            placeholder="type value, Enter to add"
            type={kind === "number" ? "number" : "text"}
            value={chipDraft}
            onChange={(e) => setChipDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation(); // adding a chip shouldn't also apply the panel
                if (chipDraft.trim()) {
                  if (!values.includes(chipDraft)) onChange({ ...cond, values: [...values, chipDraft] });
                  setChipDraft("");
                }
              }
            }}
          />
        </div>
      );
    }

    // single-value editors
    if (kind === "boolean") {
      return (
        <select className="input w-28" style={{ padding: "3px 8px", fontSize: 12 }} value={cond.value ?? ""} onChange={(e) => onChange({ ...cond, value: e.target.value })}>
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    if (kind === "enum" && cm.options) {
      return (
        <select className="input w-40" style={{ padding: "3px 8px", fontSize: 12 }} value={cond.value ?? ""} onChange={(e) => onChange({ ...cond, value: e.target.value })}>
          <option value="">—</option>
          {cm.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    }
    if (kind === "reference") {
      return (
        <div className="flex items-center gap-1.5 flex-1">
          {cond.value ? (
            <span className="tag" style={{ color: "var(--accent)" }}>
              {refLabels[cond.value] ?? cond.value}
              <button className="ml-1.5" onClick={() => onChange({ ...cond, value: "" })}>✕</button>
            </span>
          ) : (
            <RefSelect
              cm={cm}
              onSelect={(id, label) => {
                setRefLabels((m) => ({ ...m, [id]: label }));
                onChange({ ...cond, value: id });
              }}
            />
          )}
        </div>
      );
    }
    // text / number / date single value
    return (
      <input
        className="input flex-1 min-w-[120px]"
        style={{ padding: "3px 8px", fontSize: 12 }}
        type={kind === "number" ? "number" : kind === "date" ? dateType : "text"}
        placeholder="value"
        value={cond.value ?? ""}
        onChange={(e) => onChange({ ...cond, value: e.target.value })}
      />
    );
  };

  return (
    <div className="flex items-start gap-1.5 flex-wrap">
      <select
        className="input w-40"
        style={{ padding: "3px 8px", fontSize: 12 }}
        value={cond.column}
        onChange={(e) => setCol(e.target.value)}
      >
        {columns.map((c) => (
          <option key={c.col.name} value={c.col.name}>{c.label}</option>
        ))}
      </select>
      <select
        className="input w-36"
        style={{ padding: "3px 8px", fontSize: 12 }}
        value={cond.op}
        onChange={(e) => onChange({ ...cond, op: e.target.value as FilterOp, value: "", value2: "", values: [] })}
      >
        {ops.map((o) => (
          <option key={o} value={o}>{opLabel(kind, o)}</option>
        ))}
      </select>
      {valueEditor()}
      <button className="btn btn-sm btn-danger" style={{ padding: "2px 7px" }} onClick={onRemove} title="Remove condition">
        ✕
      </button>
    </div>
  );
}

// ---------- the builder ----------

export function FilterBuilder({
  columns,
  value,
  onChange,
}: {
  columns: ColumnMeta[];
  value: FilterSet;
  onChange: (set: FilterSet) => void;
}) {
  const [open, setOpen] = useState(false);
  const [set, setSet] = useState<FilterSet>(value);

  const complete = (s: FilterSet): FilterSet => ({ combinator: s.combinator, conditions: s.conditions.filter(isComplete) });
  const emit = (s: FilterSet) => onChange(complete(s));

  const applied = value; // the currently-applied filter set (from the parent)
  const activeCount = applied.conditions.filter(isComplete).length;
  // are there edits in the panel not yet applied?
  const dirty = JSON.stringify(complete(set)) !== JSON.stringify(complete(applied));

  const addCondition = () => {
    const col = columns[0];
    setSet((s) => ({
      ...s,
      conditions: [...s.conditions, { column: col.col.name, op: kindOf(col) === "text" ? "contains" : "eq", value: "" }],
    }));
  };

  const update = (i: number, c: FilterCondition) =>
    setSet((s) => ({ ...s, conditions: s.conditions.map((x, j) => (j === i ? c : x)) }));

  // remove & clear take effect immediately (unambiguous); typed values need Apply
  const remove = (i: number) =>
    setSet((s) => {
      const next = { ...s, conditions: s.conditions.filter((_, j) => j !== i) };
      emit(next);
      return next;
    });
  const clearAll = () =>
    setSet((s) => {
      const next = { ...s, conditions: [] };
      emit(next);
      return next;
    });
  const setCombinator = (c: Combinator) =>
    setSet((s) => {
      const next = { ...s, combinator: c };
      emit(next);
      return next;
    });

  return (
    <div className="w-full">
      <button
        className="btn"
        style={activeCount ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}}
        onClick={() => setOpen((o) => !o)}
      >
        ⛃ Filter{activeCount > 0 && <span className="ml-1 tag" style={{ fontSize: 10, color: "var(--accent)" }}>{activeCount}</span>}
        <span style={{ color: "var(--text-faint)", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          className="panel p-4 mt-2 w-full"
          onKeyDown={(e) => {
            // Enter anywhere in the panel applies (chip inputs stop propagation)
            if (e.key === "Enter") emit(set);
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[12.5px]" style={{ color: "var(--text-dim)" }}>Match</span>
            <div className="flex gap-0.5">
              {(["and", "or"] as Combinator[]).map((c) => (
                <button
                  key={c}
                  className="tag"
                  style={set.combinator === c ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}}
                  onClick={() => setCombinator(c)}
                >
                  {c === "and" ? "all" : "any"}
                </button>
              ))}
            </div>
            <span className="text-[12.5px]" style={{ color: "var(--text-dim)" }}>of the conditions</span>
            <span className="flex-1" />
            {set.conditions.length > 0 && (
              <button className="btn btn-sm" onClick={clearAll}>Clear</button>
            )}
          </div>

          <div className="space-y-2 max-h-[50vh] overflow-y-auto scrollbar-thin pr-1">
            {set.conditions.length === 0 && (
              <p className="text-[13px] py-2" style={{ color: "var(--text-faint)" }}>
                No conditions yet. Add one below.
              </p>
            )}
            {set.conditions.map((c, i) => (
              <ConditionRow
                key={i}
                columns={columns}
                cond={c}
                onChange={(nc) => update(i, nc)}
                onRemove={() => remove(i)}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
            <button className="btn btn-sm" onClick={addCondition}>＋ Add condition</button>
            {dirty && (
              <span className="text-[12px]" style={{ color: "var(--amber)" }}>unapplied changes</span>
            )}
            <span className="flex-1" />
            <button className="btn btn-sm" onClick={() => setOpen(false)}>Close</button>
            <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => emit(set)}>
              Apply filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
