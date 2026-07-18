import { ok, fail } from "@/lib/api";
import { getCatalog } from "@/lib/introspect/catalog";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";
import { createSearchSession } from "@/lib/data/global-search";

// POST — called once when the global search dialog opens. Resolves which
// tables (across connections the current user can read) aren't explicitly
// excluded via table_overrides.searchable=false and caches that list
// server-side under a fresh session id, so GET /api/search?q=&sessionId=
// doesn't re-resolve it on every keystroke of the same search session.
export async function POST() {
  try {
    const user = await requireUser();
    const catalog = await getCatalog();
    const readable = readableConnectionIds(user);
    const connections =
      readable === "all" ? catalog.connections : catalog.connections.filter((c) => readable.has(c.connectionId));

    const result = createSearchSession(connections);
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
