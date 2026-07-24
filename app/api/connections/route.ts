import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { addConnection, listConnections } from "@/lib/metadata/store";
import { testConnection } from "../database/postgres/pool";
import { invalidateCatalog } from "@/lib/introspect/catalog";
import { connectionSchema, redact } from "@/lib/connections-shared";
import { requireUser, requireAdmin } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";

export async function GET() {
  try {
    const user = await requireUser();
    const readable = readableConnectionIds(user);
    const conns = listConnections().filter((c) => readable === "all" || readable.has(c.id));
    // Return the list immediately without probing each database — health checks
    // (especially a slow/unreachable connection) used to serialize into the
    // page's first paint. The client fetches each connection's read/write
    // status separately and in parallel via /api/connections/[id]/status.
    return ok(conns.map(redact));
  } catch (e) {
    return fail(e);
  }
}

import { getConnection } from "@/lib/metadata/store";

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const rawBody = await req.json();
    const body = connectionSchema.parse(rawBody);
    if (listConnections().some((c) => c.name === body.name)) {
      return fail(new Error(`A connection named "${body.name}" already exists`));
    }

    let readPassword = body.readPassword;
    let writeUser = body.writeUser;
    let writePassword = body.writePassword;

    if (rawBody.cloneFrom) {
      const source = getConnection(rawBody.cloneFrom);
      if (source) {
        if (!readPassword) {
          readPassword = source.readPassword;
        }
        if (writeUser === undefined || writeUser === null) {
          writeUser = source.writeUser;
        }
        if (!writePassword) {
          writePassword = source.writePassword;
        }
      }
    }

    const conn = addConnection({
      name: body.name,
      engine: body.engine,
      host: body.host,
      port: body.port,
      database: body.database,
      readUser: body.readUser,
      readPassword: readPassword,
      writeUser: writeUser || null,
      writePassword: writePassword || null,
      ssl: body.ssl,
      allowedSchemas: body.allowedSchemas?.length ? body.allowedSchemas : null,
      options: body.options ?? null,
    });
    invalidateCatalog();
    const status = await testConnection(conn);
    return ok({ ...redact(conn), status }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
