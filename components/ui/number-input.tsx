"use client";

// Numeric input built on TypedInput (real `number` values, not strings),
// driven by the column's actual numeric metadata (see ColumnNumericInfo)
// instead of a hand-picked step/min per call site: `scale` sets the input's
// step (0 → whole numbers, 2 → cents, ...) and `unsigned` blocks "-" and
// sets min={0}. Pass `numeric: null` for a column with no numeric metadata
// (falls back to step="any", no min).
import * as React from "react";
import type { ColumnNumericInfo } from "@/lib/types";
import { TypedInput } from "@/components/ui/typed-input";

function stepFor(numeric: ColumnNumericInfo | null): number | "any" {
  if (!numeric || numeric.scale == null) return "any";
  if (numeric.scale === 0) return 1;
  return Number((10 ** -numeric.scale).toFixed(numeric.scale));
}

export function NumberInput({
  numeric,
  value,
  onChange,
  onKeyDown,
  ...props
}: Omit<React.ComponentProps<typeof TypedInput>, "type" | "value" | "onChange" | "step" | "min"> & {
  numeric: ColumnNumericInfo | null;
  value: number | "";
  onChange: (value: number | "") => void;
}) {
  const unsigned = numeric?.unsigned ?? false;
  return (
    <TypedInput
      type="number"
      step={stepFor(numeric)}
      min={unsigned ? 0 : undefined}
      value={value}
      onChange={(v) => onChange(typeof v === "number" ? v : "")}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
        if (unsigned && e.key === "-") e.preventDefault();
        onKeyDown?.(e);
      }}
      {...props}
    />
  );
}
