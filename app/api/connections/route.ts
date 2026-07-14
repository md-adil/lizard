import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { addConnection, listConnections } from "@/lib/metadata/store";
import { testConnection } from "@/lib/db/pools";
import { invalidateCatalog } from "@/lib/introspect/catalog";
import { connectionSchema, redact } from "@/lib/connections-shared";
import { requireUser, requireAdmin } from "@/lib/auth/session";
import { readableConnectionIds } from "@/lib/auth/store";

export async function GET() {
  try {
    const user = await requireUser();
    const readable = readableConnectionIds(user);
    const conns = listConnections().filter((c) => readable === "all" || readable.has(c.id));
    const withStatus = await Promise.all(
      conns.map(async (c) => {
        const status = await testConnection(c).catch(() => ({ read: "unreachable", write: null }));
        return { ...redact(c), status };
      }),
    );
    return ok(withStatus);
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
