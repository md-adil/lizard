import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { probeCredentials } from "@/lib/db/pools";
import { parseConnectionUri } from "@/lib/parse-uri";
import { DB_ENGINES, DEFAULT_PORTS, type DbEngine } from "@/lib/types";
import { requireAdmin } from "@/lib/auth/session";

import { getConnection } from "@/lib/metadata/store";

const schema = z.object({
  uri: z.string().optional(),
  cloneFrom: z.string().optional(),
  connectionId: z.string().optional(),
  engine: z.enum(DB_ENGINES as [DbEngine, ...DbEngine[]]).optional(),
  host: z.string().optional(),
  port: z.coerce.number().optional(),
  database: z.string().optional(),
  readUser: z.string().optional(),
  readPassword: z.string().optional(),
  writeUser: z.string().nullish(),
  writePassword: z.string().nullish(),
  ssl: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const b = schema.parse(await req.json());
    let engine: DbEngine = b.engine ?? "postgres";
    let host = b.host;
    let port = b.port ?? DEFAULT_PORTS[engine];
    let database = b.database;
    let readUser = b.readUser;
    let readPassword = b.readPassword ?? "";
    let writeUser = b.writeUser;
    let writePassword = b.writePassword ?? "";
    let ssl = b.ssl ?? false;

    const connId = b.connectionId || b.cloneFrom;
    if (connId) {
      const source = getConnection(connId);
      if (source) {
        engine = b.engine ?? source.engine;
        host = b.host ?? source.host;
        port = b.port ?? source.port;
        database = b.database ?? source.database;
        readUser = b.readUser ?? source.readUser;
        readPassword = b.readPassword || source.readPassword;
        writeUser = b.writeUser !== undefined ? b.writeUser : source.writeUser;
        writePassword = b.writePassword || source.writePassword || "";
        ssl = b.ssl ?? source.ssl;
      }
    }

    if (b.uri) {
      const p = parseConnectionUri(b.uri);
      if (!p) return fail(new Error("Could not parse that connection URI"));
      engine = p.engine;
      host = p.host;
      port = p.port;
      database = p.database;
      readUser = p.user;
      readPassword = p.password;
      ssl = p.ssl;
    }

    if (!host || !database || !readUser) {
      return fail(new Error("host, database and read user are required to test"));
    }

    const read = await probeCredentials({ engine, host, port, database, user: readUser, password: readPassword, ssl });
    let write: string | null = null;
    if (writeUser) {
      write = await probeCredentials({
        engine,
        host,
        port,
        database,
        user: writeUser,
        password: writePassword,
        ssl,
      });
    }
    return ok({ read, write });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
