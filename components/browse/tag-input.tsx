"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataApiUrl } from "./data-api";
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";

const CREATE_PREFIX = "__create__:";

export function TagInput({
  connection,
  schema,
  table,
  column,
  value,
  onChange,
  // "tags" flattens/dedupes a JSON-array "tag" widget column's own values
  // (the row-editor cell). "suggest" is the plain distinct-values endpoint —
  // used when this same multi-chip combobox doubles as the filter panel's
  // "in" value picker for an ordinary (non-tag) column.
  path = "tags",
  placeholder = "add tag…",
}: {
  connection: string;
  schema: string | undefined;
  table: string;
  column: string;
  value: string[];
  onChange: (val: string[]) => void;
  path?: "tags" | "suggest";
  placeholder?: string;
}) {
  const items = value;

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data: suggestions } = useQuery<string[]>({
    queryKey: [path, connection, schema, table, column, search],
    queryFn: async () => {
      const res = await fetch(dataApiUrl({ connection, table, path, schema, params: { column, q: search } }));
      if (!res.ok) throw new Error(`${path} failed`);
      return res.json();
    },
    enabled: open,
  });
  const suggestionItems = (suggestions ?? []).filter((s) => !items.includes(s));
  const trimmedSearch = search.trim();
  const showCreate = trimmedSearch !== "" && !items.includes(trimmedSearch) && !suggestionItems.includes(trimmedSearch);
  const listItems = showCreate ? [CREATE_PREFIX + trimmedSearch, ...suggestionItems] : suggestionItems;

  return (
    <Combobox<string, true>
      multiple
      autoHighlight
      items={listItems}
      value={items}
      onValueChange={(next) => {
        const cleaned = next.map((v) => (v.startsWith(CREATE_PREFIX) ? v.slice(CREATE_PREFIX.length) : v));
        onChange([...new Set(cleaned)]);
        setSearch("");
      }}
      inputValue={search}
      onInputValueChange={setSearch}
      open={open}
      onOpenChange={setOpen}
      filter={null}
    >
      <ComboboxChips>
        {items.map((it) => (
          <ComboboxChip key={it}>{it}</ComboboxChip>
        ))}
        <ComboboxChipsInput placeholder={items.length ? "" : placeholder} />
      </ComboboxChips>
      <ComboboxContent className="w-full min-w-55">
        <ComboboxEmpty className="py-2 text-xs text-muted-foreground text-center">
          No matching {path === "tags" ? "tags" : "values"}
        </ComboboxEmpty>
        <ComboboxList>
          {(v: string) =>
            v.startsWith(CREATE_PREFIX) ? (
              <ComboboxItem key={v} value={v} className="text-primary font-medium">
                ＋ Use "{v.slice(CREATE_PREFIX.length)}"
              </ComboboxItem>
            ) : (
              <ComboboxItem key={v} value={v}>
                {v}
              </ComboboxItem>
            )
          }
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
