"use client";

// Persists the grid's per-column widths for one user/table, piggybacking on
// the generic table-prefs blob (use-table-prefs.ts) instead of a new
// table/route — same storage, just another key. Debounced on write: tanstack
// fires a sizing update on every pixel of a drag, not just at drag-end, and
// POSTing on each of those would be one request per pixel.
import { useEffect, useRef, useState } from "react";
import type { ColumnSizingState, Updater } from "@tanstack/react-table";
import { useTablePrefs } from "./use-table-prefs";

const PERSIST_DEBOUNCE_MS = 500;

export function useColumnWidths(connectionId: string | undefined, schema: string | undefined, table: string) {
  const [tablePrefs, setTablePref, loaded] = useTablePrefs(connectionId, schema, table);
  const [sizing, setSizing] = useState<ColumnSizingState>({});

  // apply the saved widths once, after they load — a ref (not state) so this
  // never re-fires and clobbers a resize made afterward (mirrors the
  // saved-view-prefs pattern in the table page).
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !loaded) return;
    applied.current = true;
    const saved = tablePrefs.columnWidths;
    if (saved && typeof saved === "object") setSizing(saved as ColumnSizingState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (debounceRef.current && clearTimeout(debounceRef.current)), []);

  function onSizingChange(updater: Updater<ColumnSizingState>) {
    setSizing((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setTablePref("columnWidths", next), PERSIST_DEBOUNCE_MS);
      return next;
    });
  }

  return [sizing, onSizingChange] as const;
}
