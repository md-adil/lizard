import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { runGuardedQuery } from "@/lib/execute";
import { requireAllReadable } from "@/lib/auth/session";

const querySchema = z.object({
  target: z.enum(["single", "federated"]),
  connections: z.array(z.string()).min(1),
  sql: z.string().min(1),
  dialect: z.enum(["postgres", "duckdb"]),
});

export async function POST(req: Request) {
  try {
    const body = querySchema.parse(await req.json());
    const user = await requireAllReadable(body.connections);
    const result = await runGuardedQuery(body, user.email);
    return ok(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
