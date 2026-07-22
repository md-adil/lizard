"use client";

// Shared masked display for columns marked `redacted` (passwords, tokens,
// secrets, ...) — cosmetic only, the real value still round-trips to the
// client; see the redaction-scope decision in the column-overrides feature.
// The eye toggle reveals it in place; each instance starts masked
// independently (grid cell, kanban card, record view, ... all mask on their
// own re-render/remount).
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { NullValue } from "@/components/browse/null-value";

export function RedactedValue({ value }: { value: unknown }) {
  const [revealed, setRevealed] = useState(false);

  if (value == null) {
    return <NullValue />;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={revealed ? undefined : "tracking-[.2em]"}>{revealed ? String(value) : "••••••••"}</span>
      <button
        type="button"
        onClick={(e) => {
          // RedactedValue often sits inside a clickable row/card — reveal
          // shouldn't also trigger that row's onClick (e.g. navigating away).
          e.stopPropagation();
          setRevealed((r) => !r);
        }}
        className="text-muted-foreground hover:text-foreground shrink-0"
        title={revealed ? "Hide" : "Show"}
      >
        {revealed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
      </button>
    </span>
  );
}
