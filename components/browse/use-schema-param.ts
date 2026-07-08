"use client";

// Schema is no longer a path segment — the browse route is
// /browse/<connection>/<table>?schema=<schema>. Schema defaults to "public"
// and is omitted from the URL when it is public, so the common Postgres case
// stays clean (/browse/<connection>/<table>). Non-public schemas (other
// Postgres schemas, or a MySQL database name) carry ?schema=<name>.
import { useSearchParams } from "next/navigation";

export function useSchemaParam(): string | undefined {
  return useSearchParams().get("schema")!;
}

function schemaQuery(schema: string): string {
  return schema ? `schema=${encodeURIComponent(schema)}` : "";
}

// Canonical builders for the new browse URLs so links stay consistent.
export function tableHref(connection: string, schema: string, table: string): string {
  const q = schemaQuery(schema);
  return `/browse/${connection}/${encodeURIComponent(table)}${q ? `?${q}` : ""}`;
}

export function recordHref(connection: string, schema: string | undefined, table: string, query = ""): string {
  const search = new URLSearchParams({ query });
  if (schema) {
    search.append("schema", schema);
  }
  const qs = search.toString();
  return `/browse/${connection}/${encodeURIComponent(table)}/record${qs ? `?${qs}` : ""}`;
}

export function customizeHref(connection: string, schema: string, table: string): string {
  const q = schemaQuery(schema);
  return `/browse/${connection}/${encodeURIComponent(table)}/customize${q ? `?${q}` : ""}`;
}
