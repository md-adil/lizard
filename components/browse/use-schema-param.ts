"use client";

// Schema is no longer a path segment — the browse route is
// /browse/<connection>/<table>?schema=<schema>. Callers decide whether a
// schema applies (via supportsSchemas(engine)) and simply omit it when it
// doesn't — MySQL/Mongo have no independent schema, so passing `undefined`
// keeps their URLs free of a misleading `schema=<database name>`.
import { useSearchParams } from "next/navigation";

export function useSchemaParam(): string | undefined {
  return useSearchParams().get("schema") ?? undefined;
}

function schemaQuery(schema: string | undefined): string {
  return schema ? `schema=${encodeURIComponent(schema)}` : "";
}

// Canonical builders for the new browse URLs so links stay consistent.
export function tableHref(args: { connection: string; schema?: string; table: string }): string {
  const q = schemaQuery(args.schema);
  return `/browse/${args.connection}/${encodeURIComponent(args.table)}${q ? `?${q}` : ""}`;
}

export function recordHref(args: {
  connection: string;
  schema?: string;
  table: string;
  // Extra params (e.g. pk, keyTransforms) as raw, unencoded values —
  // URLSearchParams encodes each exactly once, so callers must not
  // pre-encode (that produces double-encoded values like %2522 instead of %22).
  params?: Record<string, string>;
}): string {
  const search = new URLSearchParams(args.params ?? {});
  if (args.schema) search.set("schema", args.schema);
  const qs = search.toString();
  return `/browse/${args.connection}/${encodeURIComponent(args.table)}/record${qs ? `?${qs}` : ""}`;
}

export function customizeHref(args: { connection: string; schema?: string; table: string }): string {
  const q = schemaQuery(args.schema);
  return `/browse/${args.connection}/${encodeURIComponent(args.table)}/customize${q ? `?${q}` : ""}`;
}

// `tab` opens directly to a specific tab (e.g. "graph") — used when linking
// from one table's graph to a neighboring table's, so the destination lands
// on the same tab rather than resetting to the default.
export function infoHref(args: { connection: string; schema?: string; table: string; tab?: string }): string {
  const search = new URLSearchParams();
  if (args.schema) search.set("schema", args.schema);
  if (args.tab) search.set("tab", args.tab);
  const qs = search.toString();
  return `/browse/${args.connection}/${encodeURIComponent(args.table)}/info${qs ? `?${qs}` : ""}`;
}

export function viewsHref(args: { connection: string; schema?: string; table: string }): string {
  const q = schemaQuery(args.schema);
  return `/browse/${args.connection}/${encodeURIComponent(args.table)}/views${q ? `?${q}` : ""}`;
}
