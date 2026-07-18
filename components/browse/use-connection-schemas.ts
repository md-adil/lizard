"use client";

// Lazy, connection-scoped schema list — cheap (no table/column/FK
// introspection), but still a real query for Postgres, so it's only fetched
// once a connection is actually selected (sidebar, connection landing page,
// virtual-FK target picker, ...), not for every registered connection up
// front the way /api/catalog used to. See app/api/catalog/[connection]/schemas.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { LightSchemaCatalog } from "@/lib/types";

function queryKey(connectionName: string | undefined) {
  return ["connection-schemas", connectionName] as const;
}

export function useConnectionSchemas(connectionName: string | undefined) {
  const query = useQuery<{ schemas: LightSchemaCatalog[] }>({
    queryKey: queryKey(connectionName),
    queryFn: async () => {
      const res = await fetch(`/api/catalog/${encodeURIComponent(connectionName!)}/schemas`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load schemas");
      return body;
    },
    enabled: !!connectionName,
    staleTime: 60 * 60_000, // same horizon as useCatalog — schema names change rarely
  });
  return { schemas: query.data?.schemas ?? [], isLoading: query.isLoading, error: query.error as Error | null };
}

useConnectionSchemas.invalidate = (qc: QueryClient, connectionName?: string) =>
  qc.invalidateQueries({ queryKey: connectionName ? queryKey(connectionName) : ["connection-schemas"] });
