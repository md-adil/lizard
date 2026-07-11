"use client";

// Input wrapper that casts its value to the DOM's own parsed type instead of
// leaving every caller to read `e.target.value` (always a string, even for
// `type="number"`) and re-parse it themselves. `type="number"` reports a
// real `number` — read via the browser's own `valueAsNumber`, not a second
// parse of the string — so a numeric value is correct at the source, with
// no separate recast step downstream (e.g. before it reaches a query param).
import * as React from "react";
import { Input } from "@/components/ui/input";

export function TypedInput({
  type = "text",
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  type?: React.ComponentProps<typeof Input>["type"];
  value: string | number;
  onChange: (value: string | number) => void;
}) {
  return (
    <Input
      type={type}
      value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        if (type === "number") {
          onChange(Number.isNaN(e.target.valueAsNumber) ? "" : e.target.valueAsNumber);
        } else {
          onChange(e.target.value);
        }
      }}
      {...props}
    />
  );
}
