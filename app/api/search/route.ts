import { ok, fail } from "@/lib/api";
import { getCatalog } from "@/lib/introspect/catalog";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";
import { runGlobalSearch } from "@/lib/data/global-search";

// GET ?q=<term>&sessionId=<id> — cross-table search, scoped to tables opted
// into table_overrides.searchable and connections the current user can read
// (see lib/data/global-search.ts for the column-narrowing/bounded-fan-out
// design). `sessionId` comes from POST /api/search/session, called once when
// the search dialog opens — resolving the searchable-table list doesn't
// depend on the query text, so it's wasteful to redo on every keystroke.
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return ok({ hits: [], scannedTables: 0, skippedTables: 0, partial: false });

    const catalog = await getCatalog();
    const readable = readableConnectionIds(user);
    const connections =
      readable === "all" ? catalog.connections : catalog.connections.filter((c) => readable.has(c.connectionId));

    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    const result = await runGlobalSearch(connections, q, sessionId);
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
