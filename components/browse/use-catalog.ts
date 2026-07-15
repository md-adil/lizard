"use client";

// The federation-wide schema catalog — one query shared by every page that
// needs it (sidebar, browse, AI console, dashboards, ...). Call sites should
// never hardcode the ["catalog"] query key directly: use useCatalog.key when
// they need it (e.g. as a dependency) and useCatalog.invalidate(qc) after a
// mutation that changes catalog-affecting state (connections, table/column
// overrides, virtual FKs), so the key only lives in one place.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { CatalogResponse } from "@/lib/types";

const CATALOG_QUERY_KEY = ["catalog"] as const;

// Schema structure changes rarely — only when a connection or its
// tables/columns are edited (those flows call useCatalog.invalidate()
// explicitly), so a long staleTime avoids refetching on every page navigation
// while still picking up real changes immediately via invalidation.
const CATALOG_STALE_TIME_MS = 60 * 60_000;

export function useCatalog() {
  return useQuery<CatalogResponse>({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error("Failed to load catalog");
      return res.json();
    },
    staleTime: CATALOG_STALE_TIME_MS,
  });
}

useCatalog.key = CATALOG_QUERY_KEY;
useCatalog.invalidate = (qc: QueryClient) => qc.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
