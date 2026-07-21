"use client";

// Shared "search a reference table, pick a row" combobox — every place that
// lets a user resolve an id -> label against a real or virtual FK target
// (filter values, row-editor FK cells) renders through this instead of
// re-implementing the refs-search fetch + dropdown.
import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { dataApiUrl } from "./data-api";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";

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

async function fetchRefOptions(target: RefTarget, q: string): Promise<RefOption[]> {
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
}

function refOptionsQuery(target: RefTarget, q: string, enabled: boolean) {
  return {
    queryKey: ["refs", target.connection, target.schema, target.table, target.column, q],
    queryFn: () => fetchRefOptions(target, q),
    enabled,
  };
}

function useRefOptions(target: RefTarget, q: string, enabled: boolean) {
  return useQuery<RefOption[]>(refOptionsQuery(target, q, enabled));
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
  const { data: options, isFetching } = useRefOptions(target, search, open);
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
      <ComboboxInput placeholder={placeholder ?? `Search ${target.table}…`} className={className} showClear>
        {isFetching && (
          <InputGroupAddon align="inline-start">
            <Loader2 className="size-3.5 animate-spin" />
          </InputGroupAddon>
        )}
      </ComboboxInput>
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

// Multi-select variant for the filter panel's reference "in" list — same
// search-and-pick backend as RefCombobox, rendered as removable chips
// instead of swapping a single value in and out.
export function RefMultiCombobox({
  target,
  value,
  onChange,
  placeholder,
  className,
}: {
  target: RefTarget;
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data: options, isFetching } = useRefOptions(target, search, open);

  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!options || options.length === 0) return;
    setLabels((m) => {
      let changed = false;
      const next = { ...m };
      for (const o of options) {
        if (next[o.id] !== o.label) {
          next[o.id] = o.label;
          changed = true;
        }
      }
      return changed ? next : m;
    });
  }, [options]);

  // Resolves labels for already-selected ids that never came up in a search
  // result on this page load (e.g. a saved filter reopened later) — same
  // by-id-as-search-term trick RefCombobox's own `initial` query uses, just
  // run per id (react-query dedupes/caches each by its own query key) since a
  // chip list can hold more than one unresolved id at once. Read straight off
  // the query results each render rather than folding into `labels` state —
  // avoids a second effect just to synchronize what render can compute directly.
  const unresolved = value.filter((id) => !(id in labels));
  const initialResults = useQueries({
    queries: unresolved.map((id) => refOptionsQuery(target, id, !open)),
  });
  const label = (id: string): string => {
    if (labels[id]) return labels[id];
    for (const r of initialResults) {
      const hit = r.data?.find((o) => o.id === id);
      if (hit) return hit.label;
    }
    return id;
  };

  const items = (options ?? []).map((o) => o.id).filter((id) => !value.includes(id));

  return (
    <Combobox<string, true>
      multiple
      autoHighlight
      items={items}
      value={value}
      onValueChange={(next) => {
        onChange(next);
        setSearch("");
      }}
      inputValue={search}
      onInputValueChange={setSearch}
      open={open}
      onOpenChange={setOpen}
      filter={null}
      itemToStringLabel={label}
    >
      <ComboboxChips className={className}>
        {value.map((id) => (
          <ComboboxChip key={id}>{label(id)}</ComboboxChip>
        ))}
        <ComboboxChipsInput placeholder={value.length ? "" : (placeholder ?? `Search ${target.table}…`)} />
        {isFetching && <Loader2 className="mr-1 size-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </ComboboxChips>
      <ComboboxContent className="w-full min-w-55">
        <ComboboxEmpty className="py-2 text-center text-xs text-muted-foreground">No matches</ComboboxEmpty>
        <ComboboxList>
          {(id: string) => (
            <ComboboxItem key={id} value={id}>
              {labels[id] ?? id} <span className="text-muted-foreground">({id})</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
