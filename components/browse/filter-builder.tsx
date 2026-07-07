"use client";

// Advanced, type-aware filter builder for the table browser. A "Filter" button
// opens a popover: each condition picks a column, gets operators appropriate to
// that column's kind (text / number / date / boolean / enum / reference), and
// an adaptive value editor (search-select for references, multi-select for
// enums, chip lists for "in", two inputs for "between"). Conditions combine
// with a Match-all / Match-any toggle. Emits only complete conditions.
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnMeta } from "./useTableMeta";
import type {
  FilterCondition,
  FilterOp,
  FilterSet,
  Combinator,
} from "@/lib/data/filters";
import { isComplete, NO_VALUE_OPS } from "@/lib/data/filters";
import { ReferencePickerModal } from "./reference-picker-modal";
import { Button } from "@/components/ui/button";

type Kind =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "enum"
  | "reference"
  | "array"
  | "jsonb";

function kindOf(cm: ColumnMeta): Kind {
  if (cm.ref) return "reference";
  if (cm.options && cm.options.length) return "enum";
  if (cm.widget === "array") return "array";
  if (cm.widget === "json") return "jsonb";
  if (cm.col.udtName === "bool") return "boolean";
  if (cm.col.udtName === "date") return "date";
  if (cm.col.udtName.startsWith("timestamp")) return "date";
  if (
    ["int2", "int4", "int8", "float4", "float8", "numeric", "money"].includes(
      cm.col.udtName,
    )
  )
    return "number";
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
  regex: "matches (regex)",
  arraycontains: "contains all of",
  arrayoverlap: "contains any of",
  jsonbcontains: "contains (JSON)",
};

const OPS_BY_KIND: Record<Kind, FilterOp[]> = {
  text: [
    "contains",
    "ncontains",
    "eq",
    "neq",
    "startswith",
    "endswith",
    "regex",
    "in",
    "empty",
    "nempty",
    "null",
    "notnull",
  ],
  number: [
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "in",
    "null",
    "notnull",
  ],
  date: ["eq", "gt", "gte", "lt", "lte", "between", "null", "notnull"],
  boolean: ["eq", "null", "notnull"],
  enum: ["eq", "neq", "in", "null", "notnull"],
  reference: ["eq", "neq", "in", "null", "notnull"],
  array: ["arraycontains", "arrayoverlap", "null", "notnull"],
  jsonb: ["jsonbcontains", "null", "notnull"],
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
    queryKey: [
      "refs",
      ref.connection,
      ref.schema,
      ref.table,
      ref.column,
      search,
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/data/${ref.connection}/${ref.schema}/${ref.table}/refs?column=${encodeURIComponent(ref.column)}&q=${encodeURIComponent(search)}`,
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
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data } = useRefSearch(cm, search, open);
  return (
    <div className="relative flex-1 min-w-35">
      <input
        ref={inputRef}
        className="input"
        style={{ padding: "3px 8px", fontSize: 12 }}
        placeholder={`Search ${cm.ref!.table}…`}
        value={search}
        onFocus={() => {
          setRect(inputRef.current?.getBoundingClientRect() ?? null);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setSearch(e.target.value)}
      />
      {open &&
        rect &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: rect.bottom + 2,
              left: rect.left,
              width: rect.width,
              maxHeight: 208,
              overflow: "auto",
              zIndex: 9999,
              borderRadius: 6,
              border: "1px solid var(--input)",
              background: "var(--muted)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            }}
            className="scrollbar-thin"
          >
            {data?.map((o) => (
              <Button variant="ghost" className="block w-full text-left px-3 py-1.5 text-[12.5px] hoverable"
                key={o.id}
                type="button"
               
                onMouseDown={() => {
                  onSelect(o.id, o.label);
                  setSearch("");
                }}
              >
                {o.label}{" "}
                <span style={{ color: "var(--muted-foreground-faint)" }}>({o.id})</span>
              </Button>
            ))}
            {data?.length === 0 && (
              <div
                className="px-3 py-2 text-[12px]"
                style={{ color: "var(--muted-foreground-faint)" }}
              >
                No matches
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ---------- chips (for "in" value lists) ----------

function Chips({
  values,
  labels,
  onRemove,
}: {
  values: string[];
  labels?: Record<string, string>;
  onRemove: (v: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-1">
      {values.map((v) => (
        <span key={v} className="tag" style={{ color: "var(--primary)" }}>
          {labels?.[v] ?? v}
          <Button variant="ghost" className="ml-1.5" onClick={() => onRemove(v)}>
            ✕
          </Button>
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
  const dateType = cm.col.udtName.startsWith("timestamp")
    ? "datetime-local"
    : "date";
  const [chipDraft, setChipDraft] = useState("");
  // remembered labels for reference "in" chips
  const [refLabels, setRefLabels] = useState<Record<string, string>>({});
  const [browsing, setBrowsing] = useState(false);

  const setCol = (name: string) => {
    const next = columns.find((c) => c.col.name === name)!;
    const nextKind = kindOf(next);
    const nextOp = OPS_BY_KIND[nextKind].includes(cond.op)
      ? cond.op
      : OPS_BY_KIND[nextKind][0];
    onChange({ column: name, op: nextOp, value: "", value2: "", values: [] });
  };

  const valueEditor = () => {
    if (noValue) return null;

    if (cond.op === "between") {
      const t =
        kind === "number" ? "number" : kind === "date" ? dateType : "text";
      return (
        <div className="flex items-center gap-1">
          <input
            className="input w-28"
            style={{ padding: "3px 8px", fontSize: 12 }}
            type={t}
            value={cond.value ?? ""}
            onChange={(e) => onChange({ ...cond, value: e.target.value })}
          />
          <span style={{ color: "var(--muted-foreground-faint)" }}>and</span>
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

    if (cond.op === "in" || cond.op === "arraycontains" || cond.op === "arrayoverlap") {
      const values = cond.values ?? [];
      // enum "in": checklist
      if (kind === "enum" && cm.options) {
        return (
          <div className="flex flex-wrap gap-1 max-w-70">
            {cm.options.map((o) => {
              const on = values.includes(o);
              return (
                <button
                  key={o}
                  className="tag"
                  style={
                    on
                      ? { color: "var(--primary)", borderColor: "var(--primary)" }
                      : {}
                  }
                  onClick={() =>
                    onChange({
                      ...cond,
                      values: on
                        ? values.filter((x) => x !== o)
                        : [...values, o],
                    })
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
          <div className="min-w-45">
            {browsing && (
              <ReferencePickerModal
                target={cm.ref!}
                title={`Pick ${cm.label}`}
                onPick={(id, label) => {
                  setRefLabels((m) => ({ ...m, [id]: label ?? id }));
                  if (!values.includes(id))
                    onChange({ ...cond, values: [...values, id] });
                  setBrowsing(false);
                }}
                onClose={() => setBrowsing(false)}
              />
            )}
            <Chips
              values={values}
              labels={refLabels}
              onRemove={(v) =>
                onChange({ ...cond, values: values.filter((x) => x !== v) })
              }
            />
            <div className="flex items-center gap-1">
              <RefSelect
                cm={cm}
                onSelect={(id, label) => {
                  setRefLabels((m) => ({ ...m, [id]: label }));
                  if (!values.includes(id))
                    onChange({ ...cond, values: [...values, id] });
                }}
              />
              <Button variant="outline" size="sm"
                type="button"
               
                title="Browse"
                onClick={() => setBrowsing(true)}
              >
                ⤢
              </Button>
            </div>
          </div>
        );
      }
      // text/number "in": type + Enter to add chips
      return (
        <div className="min-w-40">
          <Chips
            values={values}
            onRemove={(v) =>
              onChange({ ...cond, values: values.filter((x) => x !== v) })
            }
          />
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
                  if (!values.includes(chipDraft))
                    onChange({ ...cond, values: [...values, chipDraft] });
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
        <select
          className="input w-28"
          style={{ padding: "3px 8px", fontSize: 12 }}
          value={cond.value ?? ""}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
        >
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    if (kind === "enum" && cm.options) {
      return (
        <select
          className="input w-40"
          style={{ padding: "3px 8px", fontSize: 12 }}
          value={cond.value ?? ""}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
        >
          <option value="">—</option>
          {cm.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    if (kind === "reference") {
      return (
        <div className="flex items-center gap-1.5 flex-1">
          {browsing && (
            <ReferencePickerModal
              target={cm.ref!}
              title={`Pick ${cm.label}`}
              onPick={(id, label) => {
                setRefLabels((m) => ({ ...m, [id]: label ?? id }));
                onChange({ ...cond, value: id });
                setBrowsing(false);
              }}
              onClose={() => setBrowsing(false)}
            />
          )}
          {cond.value ? (
            <span className="tag" style={{ color: "var(--primary)" }}>
              {refLabels[cond.value] ?? cond.value}
              <Button variant="ghost" className="ml-1.5"
               
                onClick={() => onChange({ ...cond, value: "" })}
              >
                ✕
              </Button>
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
          <Button variant="outline" size="sm"
            type="button"
           
            title="Browse"
            onClick={() => setBrowsing(true)}
          >
            ⤢
          </Button>
        </div>
      );
    }
    if (kind === "jsonb") {
      return (
        <input
          className="input flex-1 min-w-40 code"
          style={{ padding: "3px 8px", fontSize: 12 }}
          placeholder={'{"key":"value"}'}
          value={cond.value ?? ""}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
        />
      );
    }
    // text / number / date single value
    return (
      <input
        className="input flex-1 min-w-30"
        style={{ padding: "3px 8px", fontSize: 12 }}
        type={
          kind === "number" ? "number" : kind === "date" ? dateType : "text"
        }
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
          <option key={c.col.name} value={c.col.name}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        className="input w-36"
        style={{ padding: "3px 8px", fontSize: 12 }}
        value={cond.op}
        onChange={(e) =>
          onChange({
            ...cond,
            op: e.target.value as FilterOp,
            value: "",
            value2: "",
            values: [],
          })
        }
      >
        {ops.map((o) => (
          <option key={o} value={o}>
            {opLabel(kind, o)}
          </option>
        ))}
      </select>
      {valueEditor()}
      <Button variant="destructive" size="sm"
       
        style={{ padding: "2px 7px" }}
        onClick={onRemove}
        title="Remove condition"
      >
        ✕
      </Button>
    </div>
  );
}

// ---------- the builder ----------

// Reusable filter panel (no trigger button — embed wherever needed).
export function FilterPanel({
  columns,
  value,
  onChange,
  onClose,
}: {
  columns: ColumnMeta[];
  value: FilterSet;
  onChange: (set: FilterSet) => void;
  onClose?: () => void;
}) {
  const [set, setSet] = useState<FilterSet>(value);

  const complete = (s: FilterSet): FilterSet => ({
    combinator: s.combinator,
    conditions: s.conditions.filter(isComplete),
  });
  const emit = (s: FilterSet) => onChange(complete(s));

  const applied = value;
  const dirty =
    JSON.stringify(complete(set)) !== JSON.stringify(complete(applied));

  const addCondition = () => {
    const col = columns[0];
    setSet((s) => ({
      ...s,
      conditions: [
        ...s.conditions,
        {
          column: col.col.name,
          op: kindOf(col) === "text" ? "contains" : "eq",
          value: "",
        },
      ],
    }));
  };

  const update = (i: number, c: FilterCondition) =>
    setSet((s) => ({
      ...s,
      conditions: s.conditions.map((x, j) => (j === i ? c : x)),
    }));

  const remove = (i: number) => {
    const next = {
      ...set,
      conditions: set.conditions.filter((_, j) => j !== i),
    };
    setSet(next);
    emit(next);
  };
  const clearAll = () => {
    const next = { ...set, conditions: [] };
    setSet(next);
    emit(next);
  };
  const setCombinator = (c: Combinator) => {
    const next = { ...set, combinator: c };
    setSet(next);
    emit(next);
  };

  return (
    <div
      className="panel p-4 mt-2"
      onKeyDown={(e) => {
        if (e.key === "Enter") emit(set);
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
          Match
        </span>
        <div className="flex gap-0.5">
          {(["and", "or"] as Combinator[]).map((c) => (
            <button
              key={c}
              className="tag"
              style={
                set.combinator === c
                  ? { color: "var(--primary)", borderColor: "var(--primary)" }
                  : {}
              }
              onClick={() => setCombinator(c)}
            >
              {c === "and" ? "all" : "any"}
            </button>
          ))}
        </div>
        <span className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
          of the conditions
        </span>
        <span className="flex-1" />
        {set.conditions.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearAll}>
            Clear
          </Button>
        )}
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto scrollbar-thin pr-1">
        {set.conditions.length === 0 && (
          <p
            className="text-[13px] py-2"
            style={{ color: "var(--muted-foreground-faint)" }}
          >
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
        <Button variant="outline" size="sm" onClick={addCondition}>
          ＋ Add condition
        </Button>
        {dirty && (
          <span className="text-[12px]" style={{ color: "var(--warning)" }}>
            unapplied changes
          </span>
        )}
        <span className="flex-1" />
        {onClose && (
          <Button variant="outline" size="sm"
           
            onClick={() => {
              emit(set);
              onClose();
            }}
          >
            Close
          </Button>
        )}
        <Button size="sm"
         
          disabled={!dirty}
          onClick={() => emit(set)}
        >
          Apply filters
        </Button>
      </div>
    </div>
  );
}

// Trigger button + inline FilterPanel (standalone, self-contained).
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
  const activeCount = value.conditions.filter(isComplete).length;

  return (
    <div>
      <Button variant="outline" className="shrink-0"
       
        style={
          activeCount
            ? { color: "var(--primary)", borderColor: "var(--primary)" }
            : {}
        }
        onClick={() => setOpen((o) => !o)}
      >
        ⛃ Filter
        {activeCount > 0 && (
          <span
            className="ml-1 tag"
            style={{ fontSize: 10, color: "var(--primary)" }}
          >
            {activeCount}
          </span>
        )}
        <span style={{ color: "var(--muted-foreground-faint)", fontSize: 10 }}>
          {open ? "▲" : "▼"}
        </span>
      </Button>
      {open && (
        <FilterPanel
          columns={columns}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
