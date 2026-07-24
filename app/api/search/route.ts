import { ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";
import { listConnections } from "@/lib/metadata/store";
import { runTableSearch } from "@/lib/data/table-search";

// GET ?q=&connection=&schema= — table NAME search for the ⌘K navigation
// palette. Nothing to do with row content (that's /api/explore now): it only
// reads cached table names (lib/introspect/table-names.ts) and merges override
// labels, so it stays cheap enough to fan out across every readable connection
// without the full catalog. `connection` is a startsWith prefix (the `conn/`
// scope); `schema` narrows further (`conn/schema/`). Scoped to the connections
// the current user can read — but NOT gated by table_overrides.searchable,
// which only concerns row-content search.
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const connectionPrefix = url.searchParams.get("connection")?.trim().toLowerCase() ?? "";
    const schema = url.searchParams.get("schema")?.trim() ?? "";

    // With neither a real query nor a connection scope there's nothing bounded
    // to return — the palette searches the cheap client-side sets (connection
    // and dashboard names) itself in that case, so don't fan out here.
    if (q.length < 2 && !connectionPrefix) return ok({ hits: [], scannedConnections: 0 });

    const readable = readableConnectionIds(user);
    let conns = listConnections().filter((c) => !c.disabled);
    if (readable !== "all") conns = conns.filter((c) => readable.has(c.id));
    if (connectionPrefix) conns = conns.filter((c) => c.name.toLowerCase().startsWith(connectionPrefix));

    const result = await runTableSearch(conns, { q, schema: schema || undefined });
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
