import { fail } from "@/lib/api";
import { getCatalog } from "@/lib/introspect/catalog";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ connection: string; schema: string }> }
) {
  try {
    const user = await requireUser();
    const { connection, schema } = await params;
    const catalog = await getCatalog();
    const conn = catalog.connections.find((c) => c.connectionName === connection);
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const readable = readableConnectionIds(user);
    if (readable !== "all" && !readable.has(conn.connectionId)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const schemaObj = conn.schemas.find((s) => s.name === schema);
    if (!schemaObj) {
      return NextResponse.json({ error: "Schema not found" }, { status: 404 });
    }
    return NextResponse.json(schemaObj);
  } catch (e) {
    return fail(e);
  }
}
