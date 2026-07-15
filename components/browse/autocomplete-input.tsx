"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { dataApiUrl } from "./data-api";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";

export interface AutocompleteTarget {
  connection: string;
  schema: string | undefined;
  table: string;
  column: string;
}

// Both endpoints take the same {column, q} shape and return string[]:
// "suggest" is a plain distinct-values query (the "autocomplete" widget),
// "tags" flattens/dedupes JSON-array "tag" widget columns into individual
// values (see distinctColumnValues in app/api/data/crud.ts) — same generic
// single-value typeahead UI, just pointed at whichever source matches the
// column's widget.
function useSuggestions(
  target: AutocompleteTarget,
  path: "suggest" | "tags",
  q: string,
  enabled: boolean,
  mode?: "contains" | "prefix",
) {
  return useQuery<string[]>({
    queryKey: [path, target.connection, target.schema, target.table, target.column, q, mode],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection: target.connection,
          table: target.table,
          path,
          schema: target.schema,
          params: { column: target.column, q, mode },
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
  // "prefix" is the filter panel's indexed "is" fast path (see
  // columnSuggestions in app/api/data/crud.ts) — a case-sensitive `LIKE
  // 'value%'` that can use a plain index, instead of the default
  // case-insensitive contains match no plain index can satisfy.
  mode,
  value,
  onChange,
  placeholder,
  className,
}: {
  target: AutocompleteTarget;
  path?: "suggest" | "tags";
  mode?: "contains" | "prefix";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: suggestions, isFetching } = useSuggestions(target, path, value, open, mode);
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
      <ComboboxInput placeholder={placeholder} className={className} showTrigger={!isFetching}>
        {isFetching && (
          <InputGroupAddon align="inline-end">
            <Loader2 className="size-3.5 animate-spin" />
          </InputGroupAddon>
        )}
      </ComboboxInput>
      <ComboboxContent>
        <ComboboxEmpty>{isFetching ? "Loading…" : "No matches"}</ComboboxEmpty>
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
