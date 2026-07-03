import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { addConnection, listConnections } from "@/lib/metadata/store";
import { testConnection } from "@/lib/db/pools";
import { invalidateCatalog } from "@/lib/introspect/catalog";
import { connectionSchema, redact } from "@/lib/connections-shared";

export async function GET() {
  const conns = listConnections();
  const withStatus = await Promise.all(
    conns.map(async (c) => {
      const status = await testConnection(c).catch(() => ({ read: "unreachable", write: null }));
      return { ...redact(c), status };
    })
  );
  return ok(withStatus);
}

export async function POST(req: Request) {
  try {
    const body = connectionSchema.parse(await req.json());
    if (listConnections().some((c) => c.name === body.name)) {
      return fail(new Error(`A connection named "${body.name}" already exists`));
    }
    const conn = addConnection({
      name: body.name,
      host: body.host,
      port: body.port,
      database: body.database,
      readUser: body.readUser,
      readPassword: body.readPassword,
      writeUser: body.writeUser || null,
      writePassword: body.writePassword || null,
      ssl: body.ssl,
      allowedSchemas: body.allowedSchemas?.length ? body.allowedSchemas : null,
    });
    invalidateCatalog();
    const status = await testConnection(conn);
    return ok({ ...redact(conn), status }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.errors.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
