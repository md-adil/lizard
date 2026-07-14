"use client";

import { useMemo } from "react";
import type { ColumnMeta } from "./useTableMeta";

// Filters the "Columns ▾" toggle list against a search term. Split out of
// DataGrid (and memoized) so the label lookup — otherwise a `.find()` over
// `columns` per toggleable column, i.e. O(n^2) — only reruns when the column
// list actually changes, not on every render/keystroke.
export function useColumnSearch<T extends { id: string }>(toggleableColumns: T[], columns: ColumnMeta[], search: string) {
  const metaByName = useMemo(() => new Map(columns.map((cm) => [cm.col.name, cm] as const)), [columns]);

  return useMemo(() => {
    const q = search.trim().toLowerCase();
    return toggleableColumns
      .map((column) => ({ column, cm: metaByName.get(column.id) }))
      .filter(({ cm, column }) => !q || (cm?.label ?? column.id).toLowerCase().includes(q));
  }, [toggleableColumns, metaByName, search]);
}
