// Canonical builder for /api/data/* URLs. Every data call needs the same
// `?schema=` handling — present for Postgres, omitted entirely for engines
// with no schema namespace (see TableMeta.schema) — so it lives here once
// instead of being hand-rolled at each fetch site.
//
// Values are passed raw: URLSearchParams encodes each exactly once, so callers
// must not pre-encode (double-encoding turns %22 into %2522).
export function dataApiUrl(args: {
  connection: string;
  table: string;
  // sub-resource under the table: "row" | "refs" | "linked" | "export" | "import".
  // Omit for the table itself (list / create).
  path?: string;
  // Omit when the connection has no schema — never pass a synthetic one.
  schema?: string;
  // `undefined` entries are dropped rather than serialized as "undefined".
  params?: Record<string, string | undefined>;
}): string {
  const qs = new URLSearchParams();
  if (args.schema) qs.set("schema", args.schema);
  for (const [key, value] of Object.entries(args.params ?? {})) {
    if (value !== undefined) qs.set(key, value);
  }
  const base = `/api/data/${encodeURIComponent(args.connection)}/${encodeURIComponent(args.table)}`;
  const suffix = args.path ? `/${args.path}` : "";
  const query = qs.toString();
  return `${base}${suffix}${query ? `?${query}` : ""}`;
}
