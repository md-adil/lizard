// Pure helpers for the resolved-reference-label model (see FkLabelSet in
// lib/types/table.ts for why a label is keyed by more than the reference
// value). Shared by the server (crud resolver) and the client (grid, record
// page, kanban). No SQL/I/O.
import type { FkLabels } from "@/lib/types";

// NUL cannot occur in a realistic column value, so distinct column tuples can
// never collide by concatenation ("a|b" + "c" vs "a" + "b|c"). Written as an
// escape, never a literal byte — a raw NUL in source breaks editors and tools.
export const FK_KEY_SEP = "\u0000";

export function fkLabelKey(row: Record<string, unknown>, keyColumns: string[]): string {
  return keyColumns.map((c) => String(row[c] ?? "")).join(FK_KEY_SEP);
}

/** The resolved label for `column` on `row`, or undefined when none applies. */
export function fkLabelFor(
  fkLabels: FkLabels | undefined,
  column: string,
  row: Record<string, unknown>,
): string | undefined {
  const set = fkLabels?.[column];
  if (!set) return undefined;
  return set.labels[fkLabelKey(row, set.keyColumns)];
}
