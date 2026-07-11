"use client";

// Shared "search a reference table, pick a row" combobox — every place that
// lets a user resolve an id -> label against a real or virtual FK target
// (filter values, row-editor FK cells) renders through this instead of
// re-implementing the refs-search fetch + dropdown.
import { useEffect, useState } from "react";
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

export interface RefTarget {
  connection: string;
  schema: string | undefined;
  table: string;
  column: string;
}

interface RefOption {
  id: string;
  label: string;
}

function useRefOptions(target: RefTarget, q: string, enabled: boolean) {
  return useQuery<RefOption[]>({
    queryKey: ["refs", target.connection, target.schema, target.table, target.column, q],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection: target.connection,
          table: target.table,
          path: "refs",
          schema: target.schema,
          params: { column: target.column, q },
        }),
      );
      if (!res.ok) throw new Error("refs failed");
      return res.json();
    },
    enabled,
  });
}

export function RefCombobox({
  target,
  value,
  onSelect,
  nullable = false,
  placeholder,
  className,
}: {
  target: RefTarget;
  // the currently selected id ("" / null / undefined = nothing selected)
  value?: string | null;
  onSelect: (id: string, label: string | null) => void;
  // adds a "∅ null" item so a nullable FK column can be cleared explicitly
  nullable?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data: options } = useRefOptions(target, search, open);
  // resolves the label of a pre-existing value the user never searched for
  // (e.g. a row loaded with a value that isn't in the current result page)
  const { data: initial } = useRefOptions(target, value ?? "", !!value && !open);

  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    const hits = [...(options ?? []), ...(initial ?? [])];
    if (hits.length === 0) return;
    setLabels((m) => {
      let changed = false;
      const next = { ...m };
      for (const o of hits) {
        if (next[o.id] !== o.label) {
          next[o.id] = o.label;
          changed = true;
        }
      }
      return changed ? next : m;
    });
  }, [options, initial]);

  const items = [...(nullable ? [""] : []), ...(options ?? []).map((o) => o.id)];

  return (
    <Combobox
      items={items}
      value={value || null}
      onValueChange={(id) => onSelect(id ?? "", id ? (labels[id] ?? null) : null)}
      onInputValueChange={setSearch}
      open={open}
      onOpenChange={setOpen}
      filter={null}
      itemToStringLabel={(id) => (id ? (labels[id] ?? id) : nullable ? "∅ null" : "")}
    >
      <ComboboxInput placeholder={placeholder ?? `Search ${target.table}…`} className={className} />
      <ComboboxContent>
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(id: string) =>
            id === "" ? (
              <ComboboxItem key="__null" value="">
                <span className="text-muted-foreground">∅ null</span>
              </ComboboxItem>
            ) : (
              <ComboboxItem key={id} value={id}>
                {labels[id] ?? id} <span className="text-muted-foreground">({id})</span>
              </ComboboxItem>
            )
          }
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
