"use client";

// Generic per-user, per-table preference blob (view type, group-by, ...),
// persisted server-side (see /api/table-prefs) so it survives reloads and
// follows the user across devices/browsers. New preferences are just new
// keys read/written through this same hook — no new table/route needed.
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function useTablePrefs(connectionId: string | undefined, schema: string | undefined, table: string) {
  const qc = useQueryClient();
  const enabled = !!connectionId && !!schema && !!table;
  const key = ["table-prefs", connectionId, schema, table];

  const { data } = useQuery<Record<string, unknown>>({
    queryKey: key,
    queryFn: async () => {
      const qs = new URLSearchParams({ connectionId: connectionId!, schema: schema!, table });
      const res = await fetch(`/api/table-prefs?${qs}`);
      if (!res.ok) throw new Error("failed to load table preferences");
      return res.json();
    },
    enabled,
    staleTime: Infinity,
  });

  function setPref(prefKey: string, value: unknown) {
    if (!enabled) return;
    qc.setQueryData<Record<string, unknown>>(key, (old) => ({ ...old, [prefKey]: value }));
    fetch("/api/table-prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, schema, table, key: prefKey, value }),
    })
      .then((res) => {
        if (!res.ok) qc.invalidateQueries({ queryKey: key });
      })
      .catch(() => {
        qc.invalidateQueries({ queryKey: key });
      });
  }

  // `data === undefined` while the initial fetch is still in flight (or
  // hasn't started, e.g. connectionId not resolved yet) — callers that apply
  // a saved value exactly once on load need to wait for this instead of just
  // checking the defaulted `{}`, or they race the fetch and misfire before
  // the real value ever arrives.
  return [data ?? {}, setPref, data !== undefined] as const;
}
