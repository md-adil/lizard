"use client";

// Generic shadcn Select wrapper for "pick one object out of a list" — every
// plain (non-searchable) dropdown renders through this instead of repeating
// the value<->object lookup and the SelectGroup boilerplate by hand.
import * as React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none__" as const;

// V is whatever key type identifies an item (string for text-shaped data,
// boolean for a true/false toggle, ...) — base-ui's Select isn't limited to
// string values, so callers don't need to stringify a value that's natively
// something else (e.g. a boolean bound straight through to a query param).
//
// getValue/getLabel default to `item.value`/`item.label`, same convention as
// the shadcn Combobox wrapper — omit them for `{ value, label }`-shaped
// items and only pass them for other shapes (e.g. plain strings, or an
// object keyed some other way).
export function DataSelect<T, V>({
  items,
  value,
  onChange,
  getValue = (item: T) => (item as { value: V }).value,
  getLabel = (item: T) => (item as { label: React.ReactNode }).label,
  placeholder = "Select…",
  label,
  clearable = false,
  clearLabel = "—",
  size = "default",
  className,
  disabled,
}: {
  items: T[];
  value: T | null;
  onChange: (item: T | null) => void;
  getValue?: (item: T) => V;
  getLabel?: (item: T) => React.ReactNode;
  placeholder?: string;
  label?: React.ReactNode;
  // adds a leading option that clears the selection back to null
  clearable?: boolean;
  clearLabel?: React.ReactNode;
  size?: "sm" | "default";
  className?: string;
  disabled?: boolean;
}) {
  const selected = value ? getValue(value) : clearable ? NONE : undefined;
  // lets <SelectValue> resolve the trigger label instead of showing the raw value
  const selectItems = [
    ...(clearable ? [{ value: NONE, label: clearLabel }] : []),
    ...items.map((item) => ({ value: getValue(item), label: getLabel(item) })),
  ];

  return (
    <Select<V | typeof NONE>
      items={selectItems}
      value={selected}
      onValueChange={(v) => onChange(v === NONE ? null : (items.find((i) => getValue(i) === v) ?? null))}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {label && <SelectLabel>{label}</SelectLabel>}
          {clearable && <SelectItem value={NONE}>{clearLabel}</SelectItem>}
          {items.map((item) => (
            <SelectItem key={String(getValue(item))} value={getValue(item)}>
              {getLabel(item)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
