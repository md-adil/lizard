"use client";

import { useState } from "react";
import type { ColumnMeta } from "./useTableMeta";
import type { FilterCondition, FilterOp, FilterSet, Combinator } from "@/lib/data/filters";
import { isComplete, NO_VALUE_OPS } from "@/lib/data/filters";
import { ReferencePickerModal } from "./reference-picker-modal";
import { RefCombobox, RefMultiCombobox } from "./ref-combobox";
import { TagInput } from "./tag-input";
import { AutocompleteInput } from "./autocomplete-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TypedInput } from "@/components/ui/typed-input";
import { NumberInput } from "@/components/ui/number-input";
import { ToggleInput } from "@/components/ui/toggle-input";
import { DataSelect } from "@/components/ui/data-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ColumnsSelect } from "@/components/browse/columns-select";
import { Filter } from "lucide-react";

type Kind = "text" | "number" | "date" | "boolean" | "enum" | "reference" | "array" | "jsonb";

// identifies the table being filtered, so a "tag" widget column's value
// editor can pull suggestions from that column's own existing values (same
// source the row-editor's TagInput/AutocompleteInput use).
export interface FilterTarget {
  connection: string;
  schema: string | undefined;
  table: string;
}

function kindOf(cm: ColumnMeta): Kind {
  if (cm.ref) return "reference";
  if (cm.options && cm.options.length) return "enum";
  if (cm.widget === "array" || cm.widget === "tag") return "array";
  if (cm.widget === "json") return "jsonb";
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
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "null", "notnull"],
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

// cond.value is a real boolean only for "boolean" kind, which never reaches
// these text-shaped editors — narrows the type for them.
function strValue(v: string | boolean | number | undefined): string {
  return typeof v === "string" ? v : "";
}

// same narrowing, but for TypedInput's number-capable editors — unlike
// strValue this must preserve a real number, or the display collapses to ""
// on every render right after the user types a valid value (the input then
// looks like it's rejecting keystrokes, since the DOM value keeps snapping
// back to empty under them). Boolean values never reach these editors — the
// "boolean" kind uses its own Select branch instead — so only undefined
// needs collapsing.
function editorValue(v: string | boolean | number | undefined): string | number {
  return v === undefined ? "" : (v as string | number);
}

// narrows to NumberInput's stricter value type.
function numValue(v: string | boolean | number | undefined): number | "" {
  return typeof v === "number" ? v : "";
}

// ---------- one condition row ----------

function ConditionRow({
  columns,
  target,
  indexedColumns,
  cond,
  onChange,
  onRemove,
}: {
  columns: ColumnMeta[];
  target: FilterTarget;
  // Which columns the server can filter without a full scan — gates the
  // indexed "is" autocomplete (see valueEditor's "text" + "eq" branch below).
  indexedColumns: string[];
  cond: FilterCondition;
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
}) {
  const cm = columns.find((c) => c.col.name === cond.column) ?? columns[0];
  const kind = kindOf(cm);
  const ops = OPS_BY_KIND[kind];
  const noValue = NO_VALUE_OPS.includes(cond.op);
  const dateType = cm.col.udtName.startsWith("timestamp") ? "datetime-local" : "date";
  const [browsing, setBrowsing] = useState(false);

  const setCol = (name: string) => {
    const next = columns.find((c) => c.col.name === name)!;
    const nextKind = kindOf(next);
    const nextOp = OPS_BY_KIND[nextKind].includes(cond.op) ? cond.op : OPS_BY_KIND[nextKind][0];
    onChange({ column: name, op: nextOp, value: "", value2: "", values: [] });
  };

  const valueEditor = () => {
    if (noValue) return null;

    if (cond.op === "between") {
      if (kind === "number") {
        return (
          <div className="flex items-center gap-1">
            <NumberInput
              className="w-28"
              numeric={cm.col.numeric}
              value={numValue(cond.value)}
              onChange={(value) => onChange({ ...cond, value })}
            />
            <span style={{ color: "var(--muted-foreground-faint)" }}>and</span>
            <NumberInput
              className="w-28"
              numeric={cm.col.numeric}
              value={numValue(cond.value2)}
              onChange={(value) => onChange({ ...cond, value2: value })}
            />
          </div>
        );
      }
      const t = kind === "date" ? dateType : "text";
      return (
        <div className="flex items-center gap-1">
          <TypedInput
            className="w-28"
            type={t}
            value={editorValue(cond.value)}
            onChange={(value) => onChange({ ...cond, value })}
          />
          <span style={{ color: "var(--muted-foreground-faint)" }}>and</span>
          <TypedInput
            className="w-28"
            type={t}
            value={cond.value2 ?? ""}
            onChange={(value) => onChange({ ...cond, value2: value })}
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
                  style={on ? { color: "var(--primary)", borderColor: "var(--primary)" } : {}}
                  onClick={() =>
                    onChange({
                      ...cond,
                      values: on ? values.filter((x) => x !== o) : [...values, o],
                    })
                  }
                >
                  {cm.optionLabels?.[o] ?? o}
                </button>
              );
            })}
          </div>
        );
      }
      // reference "in": multi-select chip combobox, same search backend as
      // the single-value RefCombobox above, plus a "browse full table" escape
      // hatch for finding a row that's hard to reach by typing.
      if (kind === "reference") {
        return (
          <div className="flex items-center gap-1 min-w-45">
            {browsing && (
              <ReferencePickerModal
                target={cm.ref!}
                title={`Pick ${cm.label}`}
                onPick={(id) => {
                  if (!values.includes(id)) onChange({ ...cond, values: [...values, id] });
                  setBrowsing(false);
                }}
                onClose={() => setBrowsing(false)}
              />
            )}
            <RefMultiCombobox
              target={cm.ref!}
              className="flex-1 min-w-35"
              value={values}
              onChange={(ids) => onChange({ ...cond, values: ids })}
            />
            <Button variant="secondary" size="sm" type="button" title="Browse" onClick={() => setBrowsing(true)}>
              ⤢
            </Button>
          </div>
        );
      }
      // "tag" widget "in": same multi-chip combobox the row-editor uses,
      // suggesting from that column's own existing tag values.
      if (cm.widget === "tag") {
        return (
          <TagInput
            connection={target.connection}
            schema={target.schema}
            table={target.table}
            column={cm.col.name}
            value={values}
            onChange={(arr) => onChange({ ...cond, values: arr })}
          />
        );
      }
      // text/number/plain-array "in": same multi-chip combobox, backed by the
      // column's own distinct values for suggestions but free to add any typed
      // value as its own chip (values here aren't constrained to what already
      // exists in the table).
      return (
        <TagInput
          connection={target.connection}
          schema={target.schema}
          table={target.table}
          column={cm.col.name}
          path="suggest"
          placeholder="type value, Enter to add"
          value={values}
          onChange={(arr) => onChange({ ...cond, values: arr })}
        />
      );
    }

    // single-value editors
    if (kind === "boolean") {
      return (
        <ToggleInput
          value={typeof cond.value === "boolean" ? cond.value : null}
          onChange={(v) => onChange({ ...cond, value: v ?? "" })}
          clearable
          className="w-28"
        />
      );
    }
    if (kind === "enum" && cm.options) {
      const options = cm.options;
      return (
        <DataSelect
          items={options}
          value={options.find((o) => o === cond.value) ?? null}
          onChange={(o) => onChange({ ...cond, value: o ?? "" })}
          getValue={(o) => o}
          getLabel={(o) => cm.optionLabels?.[o] ?? o}
          clearable
          className="w-40"
        />
      );
    }
    if (kind === "reference") {
      return (
        <div className="flex items-center gap-1.5 flex-1">
          {browsing && (
            <ReferencePickerModal
              target={cm.ref!}
              title={`Pick ${cm.label}`}
              onPick={(id) => {
                onChange({ ...cond, value: id });
                setBrowsing(false);
              }}
              onClose={() => setBrowsing(false)}
            />
          )}
          <RefCombobox
            target={cm.ref!}
            value={strValue(cond.value)}
            nullable={cm.col.nullable}
            className="flex-1 min-w-35"
            onSelect={(id) => onChange({ ...cond, value: id })}
          />
          {cond.value && (
            <Button variant="ghost" title="Clear" onClick={() => onChange({ ...cond, value: "" })}>
              ✕
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
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
        <Input
          className="flex-1 min-w-40 code"
          placeholder={'{"key":"value"}'}
          value={strValue(cond.value)}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
        />
      );
    }
    if (kind === "number") {
      return (
        <NumberInput
          className="flex-1 min-w-30"
          numeric={cm.col.numeric}
          placeholder="value"
          value={numValue(cond.value)}
          onChange={(value) => onChange({ ...cond, value })}
        />
      );
    }
    // Indexed "is" fast path: a case-sensitive prefix-match autocomplete
    // (mode="prefix") that can use a plain index on the column, instead of
    // the free-text input below with no query behind it at all.
    if (kind === "text" && cond.op === "eq" && indexedColumns.includes(cm.col.name)) {
      return (
        <AutocompleteInput
          target={{ connection: target.connection, schema: target.schema, table: target.table, column: cm.col.name }}
          mode="prefix"
          className="flex-1 min-w-30"
          placeholder="value"
          value={strValue(cond.value)}
          onChange={(value) => onChange({ ...cond, value })}
        />
      );
    }

    // text / date single value
    return (
      <TypedInput
        className="flex-1 min-w-30"
        type={kind === "date" ? dateType : "text"}
        placeholder="value"
        value={editorValue(cond.value)}
        onChange={(value) => onChange({ ...cond, value })}
      />
    );
  };

  return (
    <div className="flex items-start gap-1.5 flex-wrap">
      <ColumnsSelect
        items={columns.map((c) => c.col)}
        value={cm.col}
        onChange={(col) => col && setCol(col.name)}
        className="w-40"
      />
      <DataSelect
        items={ops}
        value={cond.op}
        onChange={(op) =>
          op &&
          onChange({
            ...cond,
            op,
            value: "",
            value2: "",
            values: [],
          })
        }
        getValue={(o) => o}
        getLabel={(o) => opLabel(kind, o)}
        className="w-36"
      />
      {valueEditor()}
      <Button
        variant="destructive"
        size="sm"

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
  target,
  indexedColumns = [],
  value,
  onChange,
  onClose,
  displayColumn,
}: {
  columns: ColumnMeta[];
  target: FilterTarget;
  // Which columns the server can filter without a full scan — gates the
  // indexed "is" autocomplete on each condition row (see ConditionRow).
  indexedColumns?: string[];
  value: FilterSet;
  onChange: (set: FilterSet) => void;
  onClose?: () => void;
  // Column a fresh condition should default to — the table's "display"
  // column reads better as a first filter than whatever happens to be
  // columns[0] (often the PK). Falls back to columns[0] when absent/hidden.
  displayColumn?: string | null;
}) {
  const defaultColumn = () => columns.find((c) => c.col.name === displayColumn) ?? columns[0];

  const [set, setSet] = useState<FilterSet>(() => {
    if (value.conditions.length > 0) return value;
    const col = defaultColumn();
    if (!col) return value;
    return {
      ...value,
      conditions: [{ column: col.col.name, op: kindOf(col) === "text" ? "contains" : "eq", value: "" }],
    };
  });

  const complete = (s: FilterSet): FilterSet => ({
    combinator: s.combinator,
    conditions: s.conditions.filter(isComplete),
  });
  const emit = (s: FilterSet) => onChange(complete(s));

  const applied = value;
  const dirty = JSON.stringify(complete(set)) !== JSON.stringify(complete(applied));

  const addCondition = () => {
    const col = defaultColumn();
    if (!col) return;
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
      className="bg-card p-4 mt-2"
      onKeyDown={(e) => {
        if (e.key === "Enter") emit(set);
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
          Match
        </span>
        <Tabs value={set.combinator} onValueChange={(v) => setCombinator(v as Combinator)}>
          <TabsList>
            <TabsTrigger value="and">all</TabsTrigger>
            <TabsTrigger value="or">any</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
          of the conditions
        </span>
        <span className="flex-1" />
        {set.conditions.length > 0 && (
          <Button variant="secondary" size="sm" onClick={clearAll}>
            Clear
          </Button>
        )}
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto scrollbar-thin p-1 -m-1">
        {set.conditions.length === 0 && (
          <p className="text-[13px] py-2" style={{ color: "var(--muted-foreground-faint)" }}>
            No conditions yet. Add one below.
          </p>
        )}
        {set.conditions.map((c, i) => (
          <ConditionRow
            key={i}
            columns={columns}
            target={target}
            indexedColumns={indexedColumns}
            cond={c}
            onChange={(nc) => update(i, nc)}
            onRemove={() => remove(i)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t">
        <Button variant="secondary" size="sm" onClick={addCondition}>
          ＋ Add condition
        </Button>
        {dirty && (
          <span className="text-[12px]" style={{ color: "var(--warning)" }}>
            unapplied changes
          </span>
        )}
        <span className="flex-1" />
        {onClose && (
          <Button
            variant="secondary"
            size="sm"

            onClick={() => {
              emit(set);
              onClose();
            }}
          >
            Close
          </Button>
        )}
        <Button
          size="sm"

          disabled={!dirty}
          onClick={() => emit(set)}
        >
          Apply filters
        </Button>
      </div>
    </div>
  );
}
