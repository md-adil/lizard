// Shared masked display for columns marked `redacted` (passwords, tokens,
// secrets, ...) — cosmetic only, the real value still round-trips to the
// client; see the redaction-scope decision in the column-overrides feature.
export function RedactedValue({ value }: { value: unknown }) {
  if (value == null) {
    return <span className="text-muted-foreground">∅</span>;
  }
  return <span className="tracking-[.2em]">••••••••</span>;
}
