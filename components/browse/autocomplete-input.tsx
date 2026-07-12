"use client";

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

// Both endpoints take the same {column, q} shape and return string[]:
// "suggest" is a plain distinct-values query (the "autocomplete" widget),
// "tags" flattens/dedupes JSON-array "tag" widget columns into individual
// values (see distinctColumnValues in lib/data/crud.ts) — same generic
// single-value typeahead UI, just pointed at whichever source matches the
// column's widget.
function useSuggestions(target: AutocompleteTarget, path: "suggest" | "tags", q: string, enabled: boolean) {
  return useQuery<string[]>({
    queryKey: [path, target.connection, target.schema, target.table, target.column, q],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection: target.connection,
          table: target.table,
          path,
          schema: target.schema,
          params: { column: target.column, q },
        }),
      );
      if (!res.ok) throw new Error(`${path} failed`);
      return res.json();
    },
    enabled,
  });
}

export function AutocompleteInput({
  target,
  path = "suggest",
  value,
  onChange,
  placeholder,
  className,
}: {
  target: AutocompleteTarget;
  path?: "suggest" | "tags";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: suggestions } = useSuggestions(target, path, value, open);
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
        <ComboboxList>
          {(v: string) => (
            <ComboboxItem key={v} value={v}>
              {v}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
