"use client";

// The dashboard list — shared by the /dashboards index page and the
// "Visualize" panel's "add to dashboard" picker. Call sites should never
// hardcode the ["dashboards"] query key directly: use useDashboards.key when
// they need it as a dependency and useDashboards.invalidate(qc) after a
// mutation that adds/renames/deletes a dashboard, so the key only lives here.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { Dashboard } from "@/lib/types";

const DASHBOARDS_QUERY_KEY = ["dashboards"] as const;

export function useDashboards(options?: { enabled?: boolean }) {
  return useQuery<Dashboard[]>({
    queryKey: DASHBOARDS_QUERY_KEY,
    queryFn: async () => (await fetch("/api/dashboards")).json(),
    enabled: options?.enabled,
  });
}

useDashboards.key = DASHBOARDS_QUERY_KEY;
useDashboards.invalidate = (qc: QueryClient) => qc.invalidateQueries({ queryKey: DASHBOARDS_QUERY_KEY });
