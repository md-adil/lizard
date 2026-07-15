import { ok, fail } from "@/lib/api";
import { getConnection } from "@/lib/metadata/store";
import { testConnection } from "@/lib/db/pools";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string }> };

// Per-connection health probe, split out of the connection list so the list
// paints immediately and each connection's read/write status streams in
// separately (the client fires these in parallel). A slow or unreachable
// database now only delays its own badge, not the whole page.
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireConnectionAccess(id, "read");
    const conn = getConnection(id);
    if (!conn) return fail(new Error("Connection not found"));
    const status = await testConnection(conn).catch(() => ({ read: "unreachable", write: null }));
    return ok(status);
  } catch (e) {
    return fail(e);
  }
}
