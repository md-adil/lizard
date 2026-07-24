import { ok, fail } from "@/lib/api";
import { getCatalog } from "@/lib/introspect/catalog";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";
import { runGlobalSearch } from "@/lib/data/global-search";

// the ⌘K navigation palette and never touches row data.
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
    // Propagates cancellation: the client aborts the previous fetch as soon
    // as a new keystroke (or navigation) supersedes it, which surfaces here as
    // req.signal.
    const result = await runGlobalSearch(connections, q, sessionId, undefined, req.signal);
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
