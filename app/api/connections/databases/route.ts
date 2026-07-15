import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { discoverDatabases } from "@/lib/db/pools";
import { getConnection } from "@/lib/metadata/store";
import { DB_ENGINES, DEFAULT_PORTS, type DbEngine } from "@/lib/types";
import { requireAdmin } from "@/lib/auth/session";

const schema = z.object({
  connectionId: z.string().optional(),
  engine: z.enum(DB_ENGINES as [DbEngine, ...DbEngine[]]).optional(),
  host: z.string().optional(),
  port: z.coerce.number().optional(),
  database: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  ssl: z.boolean().optional(),
  options: z.string().nullish(),
});

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const b = schema.parse(await req.json());
    let engine: DbEngine;
    let host: string;
    let port: number;
    let database: string;
    let user: string;
    let password = "";
    let ssl = false;
    let options: string | null = null;

    if (b.connectionId) {
      const conn = getConnection(b.connectionId);
      if (!conn) return fail(new Error("Connection not found"));
      engine = conn.engine;
      host = conn.host;
      port = conn.port;
      database = conn.database;
      user = conn.readUser;
      password = conn.readPassword;
      ssl = conn.ssl;
      options = conn.options;
    } else {
      if (!b.engine || !b.host || !b.database || !b.user) {
        return fail(new Error("Missing required connection parameters"));
      }
      engine = b.engine;
      host = b.host;
      port = b.port ?? DEFAULT_PORTS[engine];
      database = b.database;
      user = b.user;
      password = b.password ?? "";
      ssl = b.ssl ?? false;
      options = b.options ?? null;
    }

    const databases = await discoverDatabases({
      engine,
      host,
      port,
      database,
      user,
      password,
      ssl,
      options,
    });
    return ok(databases);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
