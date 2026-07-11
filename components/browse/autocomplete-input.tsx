"use client";

// Free-text input with type-ahead suggestions drawn from the column's own
// existing distinct values (not a fixed enum) — helps reuse a value already
// in use (e.g. "New York" vs a typo'd near-duplicate) without constraining
// what can be typed; suggestions are a hint, any text is accepted.
//
// `value` is always injected into `items` when it isn't already a
// suggestion, so the currently-typed text is a real, selectable item rather
// than text the Combobox has no record of "selecting" — keeps its internal
// selected-value state consistent with `inputValue` and avoids it reverting
// unsubmitted free text on blur/close.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataApiUrl } from "./data-api";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";

export interface AutocompleteTarget {
  connection: string;
  schema: string | undefined;
  table: string;
  column: string;
}

function useSuggestions(target: AutocompleteTarget, q: string, enabled: boolean) {
  return useQuery<string[]>({
    queryKey: ["suggest", target.connection, target.schema, target.table, target.column, q],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection: target.connection,
          table: target.table,
          path: "suggest",
          schema: target.schema,
          params: { column: target.column, q },
        }),
      );
      if (!res.ok) throw new Error("suggest failed");
      return res.json();
    },
    enabled,
  });
}

export function AutocompleteInput({
  target,
  value,
  onChange,
  placeholder,
  className,
}: {
  target: AutocompleteTarget;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: suggestions } = useSuggestions(target, value, open);
  const trimmed = value.trim();
  const base = (suggestions ?? []).filter((s) => s !== value);
  const items = trimmed && !base.includes(trimmed) ? [value, ...base] : base;

  return (
    <Combobox<string>
      items={items}
      value={value || null}
      inputValue={value}
      onInputValueChange={onChange}
      onValueChange={(v) => onChange(v ?? "")}
      open={open}
      onOpenChange={setOpen}
      filter={null}
    >
      <ComboboxInput placeholder={placeholder} className={className} />
      <ComboboxContent>
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>{(v: string) => <ComboboxItem key={v} value={v}>{v}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
