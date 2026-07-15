"use client";

// The connection list — shared by the connections tab, the connection
// create/edit form, and the users tab's grant editor. Call sites should
// never hardcode the ["connections"] query key directly: use
// useConnections.invalidate(qc) after a mutation that adds/edits/deletes/
// disables a connection, so the key only lives here.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { ConnectionRow } from "@/app/settings/connection-form";

const CONNECTIONS_QUERY_KEY = ["connections"] as const;

export function useConnections(options?: { enabled?: boolean }) {
  return useQuery<ConnectionRow[]>({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: async () => (await fetch("/api/connections")).json(),
    enabled: options?.enabled,
  });
}

useConnections.key = CONNECTIONS_QUERY_KEY;
useConnections.invalidate = (qc: QueryClient) => qc.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
