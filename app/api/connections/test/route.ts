import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { probeCredentials } from "@/lib/db/pools";
import { parsePostgresUri } from "@/lib/parse-uri";

// Probe connectivity without saving. Accepts either explicit fields or a `uri`.
const schema = z.object({
  uri: z.string().optional(),
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
    const b = schema.parse(await req.json());
    let host = b.host;
    let port = b.port ?? 5432;
    let database = b.database;
    let readUser = b.readUser;
    let readPassword = b.readPassword ?? "";
    let ssl = b.ssl ?? false;

    if (b.uri) {
      const p = parsePostgresUri(b.uri);
      if (!p) return fail(new Error("Could not parse that connection URI"));
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

    const read = await probeCredentials({ host, port, database, user: readUser, password: readPassword, ssl });
    let write: string | null = null;
    if (b.writeUser) {
      write = await probeCredentials({ host, port, database, user: b.writeUser, password: b.writePassword ?? "", ssl });
    }
    return ok({ read, write });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.errors.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
