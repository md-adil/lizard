import { ok, fail } from "@/lib/api";
import { getCatalog, invalidateCatalog } from "@/lib/introspect/catalog";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";
import type { CatalogResponse } from "@/lib/types";

// Light connection/schema tree only — table detail, virtual FKs, and
// overrides load lazily per connection (+ optional schema, Postgres-only)
// from `/api/catalog/[connection]?schema=…` so this stays cheap regardless
// of how many schemas/tables/columns exist across the fleet.
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    if (url.searchParams.get("refresh")) invalidateCatalog();
    const catalog = await getCatalog();
    // non-admins only see connections they've been granted
    const readable = readableConnectionIds(user);
    const connections =
      readable === "all" ? catalog.connections : catalog.connections.filter((c) => readable.has(c.connectionId));
    const response: CatalogResponse = {
      connections: connections.map((c) => ({
        connectionId: c.connectionId,
        connectionName: c.connectionName,
        database: c.database,
        engine: c.engine,
        error: c.error,
        schemas: c.schemas.map((s) => ({ name: s.name })),
      })),
    };
    return ok(response);
  } catch (e) {
    return fail(e);
  }
}
