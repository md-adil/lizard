import * as React from "react";
import { getTimezoneOffset } from "@/lib/data/timezones";

export interface TimezoneCellProps {
  value: unknown;
  className?: string;
}

export function TimezoneCell({ value, className }: TimezoneCellProps) {
  const tz = String(value || "").trim();
  if (!tz) return <span className="text-muted-foreground">∅</span>;

  const offset = getTimezoneOffset(tz);
  const offsetStr = offset ? ` (${offset})` : "";

  return (
    <span className={className}>
      {tz}
      {offsetStr && <span className="text-[11px] text-muted-foreground font-mono ml-1">{offsetStr}</span>}
    </span>
  );
}
