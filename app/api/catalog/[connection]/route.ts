import { ok, fail } from "@/lib/api";
import { getCatalog } from "@/lib/introspect/catalog";
import { requireUser } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";
import {
  listVirtualFksForConnection,
  listTableOverridesForConnection,
  listColumnOverridesForConnection,
} from "@/lib/metadata/store";
import type { SchemaDetail } from "@/lib/types";
import { NextResponse } from "next/server";

// `schema` is only meaningful for Postgres (a connection can have many). For
// MySQL/Mongo, where a connection has exactly one synthetic schema, it's
// optional and this resolves to that single schema automatically.
export async function GET(req: Request, { params }: { params: Promise<{ connection: string }> }) {
  try {
    const user = await requireUser();
    const { connection } = await params;
    const schema = new URL(req.url).searchParams.get("schema");
    const catalog = await getCatalog();
    const conn = catalog.connections.find((c) => c.connectionName === connection);
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const readable = readableConnectionIds(user);
    if (readable !== "all" && !readable.has(conn.connectionId)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // Omitted schema resolves to the connection's one schema (MySQL/Mongo),
    // or Postgres's conventional "public" default when there are several.
    const schemaObj = schema
      ? conn.schemas.find((s) => s.name === schema)
      : (conn.schemas.length === 1 ? conn.schemas[0] : undefined) ?? conn.schemas.find((s) => s.name === "public");
    if (!schemaObj) {
      return NextResponse.json({ error: "Schema not found" }, { status: 404 });
    }

    const response: SchemaDetail = {
      ...schemaObj,
      virtualFks: listVirtualFksForConnection(connection),
      tableOverrides: listTableOverridesForConnection(conn.connectionId),
      columnOverrides: listColumnOverridesForConnection(conn.connectionId),
    };
    return ok(response);
  } catch (e) {
    return fail(e);
  }
}
