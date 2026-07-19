"use client";

// Shared pieces for dashboard variables, used by both the live toolbar on
// the dashboard view (app/dashboards/[id]/page.tsx) and the definition
// editor on the dashboard settings page (app/dashboards/[id]/settings).
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DashboardVariable, QueryResult, VariableOption } from "@/lib/types";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";

// Drop-in replacement for DataSelect (same getValue/getLabel/placeholder
// prop shape) backed by Combobox instead of Select, so every variable-related
// dropdown is searchable — worth it once a connection/column/option list
// runs past a handful of entries.
export function SearchableSelect<T, V extends string>({
  items,
  value,
  onChange,
  getValue = (item: T) => (item as { value: V }).value,
  getLabel = (item: T) => String((item as { label: unknown }).label),
  placeholder = "— select —",
  className,
  disabled,
  loading = false,
}: {
  items: T[];
  value: T | null;
  onChange: (item: T | null) => void;
  getValue?: (item: T) => V;
  getLabel?: (item: T) => string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const labelByValue = new Map(items.map((item) => [getValue(item), getLabel(item)]));
  const values = items.map(getValue);
  return (
    <Combobox
      items={values}
      value={value ? getValue(value) : null}
      onValueChange={(v) => onChange(v ? (items.find((i) => getValue(i) === v) ?? null) : null)}
      disabled={disabled || loading}
    >
      <ComboboxInput placeholder={loading ? "Loading…" : placeholder} className={className} disabled={disabled || loading} />
      <ComboboxContent>
        <ComboboxEmpty>No results</ComboboxEmpty>
        <ComboboxList>{(v: V) => <ComboboxItem key={v} value={v}>{labelByValue.get(v) ?? v}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// Builds {label,value} option pairs from a query result: valueField is
// substituted into SQL, labelField (defaulting to valueField) is just for
// display — e.g. valueField "id", labelField "name" for an id/name lookup
// table. Deduped by value, first label wins.
export function optionsFromResult(
  result: QueryResult,
  valueField: string | null,
  labelField: string | null,
): VariableOption[] {
  const valueCol = valueField ?? result.columns[0]?.name;
  const labelCol = labelField ?? valueCol;
  if (!valueCol) return [];
  const byValue = new Map<string, string>();
  for (const row of result.rows) {
    const value = String(row[valueCol]);
    if (!byValue.has(value)) byValue.set(value, labelCol ? String(row[labelCol]) : value);
  }
  return [...byValue].map(([value, label]) => ({ label, value }));
}

// The live "pick a value" control shown in the dashboard toolbar — as
// opposed to VariableFormDialog, which defines what the variable IS, this
// just lets a viewer change its current value.
export function VariableValueControl({
  variable,
  onChange,
}: {
  variable: DashboardVariable;
  onChange: (value: string) => void;
}) {
  if (variable.type === "text") {
    return <Input className="w-36 h-8" value={variable.value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (variable.source.kind === "static") {
    const options = variable.source.options;
    return (
      <SearchableSelect
        items={options}
        value={options.find((o) => o.value === variable.value) ?? null}
        onChange={(o) => onChange(o?.value ?? "")}
        className="w-36"
      />
    );
  }
  return <QueryBackedSelect source={variable.source} value={variable.value} onChange={onChange} />;
}

function QueryBackedSelect({
  source,
  value,
  onChange,
}: {
  source: Extract<DashboardVariable, { type: "select" }>["source"] & { kind: "query" };
  value: string;
  onChange: (value: string) => void;
}) {
  const { data, isLoading, error } = useQuery<QueryResult>({
    queryKey: ["dashboard-var-options", source.sql, source.connections, source.dialect, source.target],
    queryFn: async () => {
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
      if (!res.ok) throw new Error(body.error ?? "query failed");
      return body;
    },
    enabled: source.connections.length > 0 && !!source.sql.trim(),
    staleTime: 5 * 60_000,
  });
  const options = data ? optionsFromResult(data, source.valueField, source.labelField) : [];

  // Auto-pick the first option once loaded if nothing's selected yet — same
  // "don't make the user click twice" convenience as a plain select's first
  // value.
  useEffect(() => {
    if (!value && options.length > 0) onChange(options[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.map((o) => o.value).join(" ")]);

  return (
    <SearchableSelect
      items={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={(o) => onChange(o?.value ?? "")}
      className="w-36"
      loading={isLoading}
      placeholder={error ? "query failed" : "— select —"}
    />
  );
}
