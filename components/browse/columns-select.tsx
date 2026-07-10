"use client";

// Shared searchable column picker — every "pick a column" dropdown in the app
// (chart field pickers, virtual-FK join columns, etc.) renders through this
// instead of repeating the Combobox boilerplate, so a table with hundreds of
// columns stays searchable everywhere. Works against the caller's real column
// object (ColumnInfo, QueryResultColumn, ...), not a bare name string — the
// caller never has to re-`.find()` an item by name after picking it.
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";

export function ColumnsSelect<T extends { name: string }>({
  items,
  value,
  onChange,
  placeholder = "— select column —",
  emptyText = "No columns found",
  className,
  disabled,
}: {
  items: T[];
  value: T | null;
  onChange: (item: T | null) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const names = items.map((c) => c.name);
  return (
    <Combobox
      items={names}
      value={value?.name ?? null}
      onValueChange={(name) => onChange(items.find((c) => c.name === name) ?? null)}
      disabled={disabled}
    >
      <ComboboxInput placeholder={placeholder} className={className} disabled={disabled} />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
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
