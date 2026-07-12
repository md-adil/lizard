"use client";

// Boolean true/false dropdown built on DataSelect — one source for the
// pattern instead of a near-duplicate options array + DataSelect block at
// every call site that edits a boolean column.
import type { ReactNode } from "react";
import { DataSelect } from "@/components/ui/data-select";

const OPTIONS = [
  { value: true, label: "true" },
  { value: false, label: "false" },
];

export function ToggleInput({
  value,
  onChange,
  clearable = false,
  clearLabel = "—",
  className,
  size,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  // adds a leading option that clears the selection back to null (e.g. a
  // nullable column's explicit "unset" state)
  clearable?: boolean;
  clearLabel?: ReactNode;
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <DataSelect
      items={OPTIONS}
      value={OPTIONS.find((o) => o.value === value) ?? null}
      onChange={(o) => onChange(o?.value ?? null)}
      clearable={clearable}
      clearLabel={clearLabel}
      className={className}
      size={size}
    />
  );
}
