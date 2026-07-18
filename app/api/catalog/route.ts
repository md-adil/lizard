import { ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";
import { listConnections } from "@/lib/metadata/store";
import type { CatalogResponse } from "@/lib/types";

// Connection list only — a cheap, local metadata-DB read, no live database
// connection at all. This used to call getCatalog(), which fully
// introspected every registered connection just to strip the result down to
// schema names — meaning one slow/unreachable connection stalled this
// endpoint (and with it every page, since the sidebar and everything else
// share this one query). Schema names now load lazily per connection, once
// actually selected, via /api/catalog/[connection]/schemas; table detail is
// lazier still, per schema, via /api/catalog/[connection]?schema=.
export async function GET() {
  try {
    const user = await requireUser();
    const readable = readableConnectionIds(user);
    const conns = listConnections().filter((c) => !c.disabled);
    const visible = readable === "all" ? conns : conns.filter((c) => readable.has(c.id));
    const response: CatalogResponse = {
      connections: visible.map((c) => ({
        connectionId: c.id,
        connectionName: c.name,
        database: c.database,
        engine: c.engine,
        schemas: [],
      })),
    };
    return ok(response);
  } catch (e) {
    return fail(e);
  }
}
