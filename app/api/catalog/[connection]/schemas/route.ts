import { ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";
import { getConnection } from "@/lib/metadata/store";
import { listSchemaNames } from "@/lib/introspect/catalog";
import type { LightSchemaCatalog } from "@/lib/types";
import { NextResponse } from "next/server";

// Cheap, connection-scoped schema name list — no table/column/FK
// introspection. Called lazily once a connection is actually selected (see
// components/browse/use-connection-schemas.ts), unlike /api/catalog, which
// only ever lists connections themselves now.
export async function GET(req: Request, { params }: { params: Promise<{ connection: string }> }) {
  try {
    const user = await requireUser();
    const { connection } = await params;
    const conn = getConnection(connection);
    if (!conn || conn.disabled) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const readable = readableConnectionIds(user);
    if (readable !== "all" && !readable.has(conn.id)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const schemas: LightSchemaCatalog[] = await listSchemaNames(conn);
    return ok({ schemas });
  } catch (e) {
    return fail(e);
  }
}
