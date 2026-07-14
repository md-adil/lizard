"use client";

// Fetches one row fresh by primary key — used by RowEditor to refresh its
// data before showing the edit form, since the grid/kanban/gallery only
// fetch a subset of columns (see ColumnOverride.hiddenInGrid) and the row
// they handed the editor may simply be stale by the time "Edit" is clicked.
import { useQuery } from "@tanstack/react-query";
import { dataApiUrl } from "./data-api";

export function useFreshRow(
  connection: string,
  schema: string | undefined,
  table: string,
  pk: Record<string, unknown> | null,
  enabled: boolean,
) {
  return useQuery<Record<string, unknown>>({
    queryKey: ["row-editor-row", connection, schema, table, pk],
    queryFn: async () => {
      const res = await fetch(
        dataApiUrl({
          connection,
          table,
          path: "row",
          schema,
          params: { pk: JSON.stringify(pk) },
        }),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load row");
      return body.row;
    },
    enabled: enabled && !!pk,
    // always refetch on mount — the whole point is to not trust a cached
    // (possibly stale/pruned) copy of this row.
    staleTime: 0,
    retry: false,
  });
}
