"use client";

// Multi-value tag editor built on the Combobox's native `multiple` (chips)
// mode — the column stores a JSON array of strings per row (matches
// ChipInput's convention for the "array" widget in row-editor.tsx).
// Suggestions are the unique tag values already used elsewhere in the table
// (see /tags, which flattens every row's array and dedupes across rows — a
// plain distinct-values query would only dedupe whole arrays).
//
// Tags aren't constrained to previously-used values — typing something new
// and pressing Enter must add it too. The reliable way to do that is to make
// the typed text a real, selectable item (as "Create '<text>'") so it's
// committed through the Combobox's own selection machinery, rather than a
// custom onKeyDown side-channel racing the primitive's internal Enter
// handling in multi-select mode.
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
}: {
  connection: string;
  schema: string | undefined;
  table: string;
  column: string;
  value: string;
  onChange: (val: string) => void;
}) {
  let items: string[] = [];
  try {
    const parsed = value ? JSON.parse(value) : [];
    if (Array.isArray(parsed)) items = parsed.map((x) => String(x));
  } catch {
    /* treat as empty */
  }

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data: suggestions } = useQuery<string[]>({
    queryKey: ["tags", connection, schema, table, column, search],
    queryFn: async () => {
      const res = await fetch(dataApiUrl({ connection, table, path: "tags", schema, params: { column, q: search } }));
      if (!res.ok) throw new Error("tags failed");
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
        onChange(JSON.stringify([...new Set(cleaned)]));
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
        <ComboboxChipsInput placeholder={items.length ? "" : "add tag…"} />
      </ComboboxChips>
      <ComboboxContent className="w-full min-w-[220px]">
        <ComboboxEmpty className="py-2 text-xs text-muted-foreground text-center">No matching tags</ComboboxEmpty>
        <ComboboxList>
          {(v: string) =>
            v.startsWith(CREATE_PREFIX) ? (
              <ComboboxItem key={v} value={v} className="text-primary font-medium">
                ＋ Create tag "{v.slice(CREATE_PREFIX.length)}"
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
