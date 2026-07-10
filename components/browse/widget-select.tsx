"use client";

// Searchable widget-type picker, built on the same Combobox primitives as
// ColumnsSelect — the widget list is short today but expected to grow into
// the hundreds (custom/plugin widgets), each optionally with a small leading
// icon, so this is a combobox from the start rather than a plain <select>.
import type { ReactNode } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";

// { value, label } is a shape Base UI's Combobox recognizes natively — it
// shows `label` in the closed input/list and tracks `value` as the item's
// identity, so an empty-string value (our "auto" option) still displays as
// "auto" instead of the raw value.
export interface WidgetOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export function WidgetSelect({
  items,
  value,
  onChange,
  placeholder = "— select widget —",
  emptyText = "No widgets found",
  className,
  disabled,
}: {
  items: WidgetOption[];
  value: WidgetOption;
  onChange: (value: WidgetOption) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Combobox
      items={items}
      value={value}
      isItemEqualToValue={(a, b) => a.value === b.value}
      onValueChange={(v) => onChange(v ?? items[0])}
      disabled={disabled}
    >
      <ComboboxInput placeholder={placeholder} className={className} disabled={disabled} />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(item: WidgetOption) => (
            <ComboboxItem key={item.value} value={item} className="gap-1.5">
              {item.icon}
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
