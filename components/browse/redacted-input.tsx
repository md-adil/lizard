"use client";

// Editable counterpart to RedactedValue: a password-style input with a
// reveal toggle, for any `redacted` column (passwords, tokens, secrets, ...).
// Owns its own reveal state — each field starts masked, independent of
// every other redacted field on the same form.
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

export function RedactedInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <InputGroup className={className}>
      <InputGroupInput type={revealed ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" title={revealed ? "Hide" : "Show"} onClick={() => setRevealed((r) => !r)}>
          {revealed ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
