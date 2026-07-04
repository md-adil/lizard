import { ok, fail } from "@/lib/api";
import { getCatalog, invalidateCatalog } from "@/lib/introspect/catalog";
import { listTableOverrides, listColumnOverrides } from "@/lib/metadata/store";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";

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
    const visibleIds = new Set(connections.map((c) => c.connectionId));
    return ok({
      connections,
      virtualFks: catalog.virtualFks,
      tableOverrides: listTableOverrides().filter((o) => visibleIds.has(o.connectionId)),
      columnOverrides: listColumnOverrides().filter((o) => visibleIds.has(o.connectionId)),
    });
  } catch (e) {
    return fail(e);
  }
}
