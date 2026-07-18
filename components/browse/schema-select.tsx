"use client";

// Searchable schema picker — a connection can have thousands of schemas
// (multi-tenant "org_*"-style Postgres DBs are common), so this is a
// filterable combobox rather than a plain dropdown. Kept separate from
// ColumnsSelect even though the shape is identical ({name}-keyed items):
// that component is for columns specifically, not a general "pick a
// name" widget.
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import type { LightSchemaCatalog } from "@/lib/types";

export function SchemaSelect({
  items,
  value,
  onChange,
  placeholder = "— select schema —",
  className,
  disabled,
}: {
  items: LightSchemaCatalog[];
  value: string | null;
  onChange: (schemaName: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const names = items.map((s) => s.name);
  return (
    <Combobox items={names} value={value} onValueChange={onChange} disabled={disabled}>
      <ComboboxInput placeholder={placeholder} className={className} disabled={disabled} />
      <ComboboxContent>
        <ComboboxEmpty>No schemas found</ComboboxEmpty>
        <ComboboxList>
          {(name) => (
            <ComboboxItem key={name} value={name}>
              {name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
