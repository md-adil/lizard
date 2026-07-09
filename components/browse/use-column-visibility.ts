"use client";

// Per-user "Columns" visibility toggle for the grid, persisted server-side
// (see /api/column-prefs) so it survives reloads and follows the user across
// devices/browsers. Distinct from table-customization's "hidden" column
// override, which is a shared structural hide applied for every user across
// every surface (grid, record page, RowEditor).
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { VisibilityState, Updater } from "@tanstack/react-table";

// `schema` should be the resolved, always-concrete schema (e.g. TableMeta's
// internal schemaMeta.name, not the possibly-undefined public meta.schema) —
// this is a storage key, not something shown in a URL, so every engine needs
// a real value here.
export function useColumnVisibility(connectionId: string | undefined, schema: string | undefined, table: string) {
  const qc = useQueryClient();
  const enabled = !!connectionId && !!schema && !!table;
  const key = ["column-prefs", connectionId, schema, table];

  const { data } = useQuery<Record<string, boolean>>({
    queryKey: key,
    queryFn: async () => {
      const qs = new URLSearchParams({
        connectionId: connectionId!,
        schema: schema!,
        table,
      });
      const res = await fetch(`/api/column-prefs?${qs}`);
      if (!res.ok) throw new Error("failed to load column prefs");
      return res.json();
    },
    enabled,
    staleTime: Infinity,
  });

  // stored map is { [column]: hidden }; TanStack's VisibilityState is
  // { [column]: isVisible } (absent = visible) — invert on the way in.
  const columnVisibility = useMemo<VisibilityState>(() => {
    const out: VisibilityState = {};
    for (const [col, hidden] of Object.entries(data ?? {})) out[col] = !hidden;
    return out;
  }, [data]);

  function setColumnVisibility(updater: Updater<VisibilityState>) {
    if (!enabled) return;
    const next = typeof updater === "function" ? updater(columnVisibility) : updater;
    for (const [col, visible] of Object.entries(next)) {
      if (columnVisibility[col] === visible) continue;
      const hidden = !visible;
      qc.setQueryData<Record<string, boolean>>(key, (old) => ({
        ...old,
        [col]: hidden,
      }));
      fetch("/api/column-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, schema, table, column: col, hidden }),
      }).catch(() => {
        qc.invalidateQueries({ queryKey: key });
      });
    }
  }

  return [columnVisibility, setColumnVisibility] as const;
}
