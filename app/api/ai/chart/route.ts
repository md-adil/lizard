import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { planChart } from "@/lib/ai";
import { runGuardedQuery } from "@/lib/execute";
import { requireUser, requireAllReadable, AuthError } from "@/lib/auth/session";

const bodySchema = z.object({
  prompt: z.string().min(1),
  connections: z.array(z.string()).optional(),
});

export const maxDuration = 60;

export async function POST(req: Request) {
  let spec;
  let user;
  try {
    user = await requireUser();
    const body = bodySchema.parse(await req.json());
    spec = await planChart(body.prompt, body.connections);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
  try {
    await requireAllReadable(spec.connections);
    const result = await runGuardedQuery(
      {
        target: spec.target,
        connections: spec.connections,
        sql: spec.sql,
        dialect: spec.dialect,
      },
      user.email,
    );
    return ok({ spec, result });
  } catch (e) {
    if (e instanceof AuthError) return ok({ spec, error: e.message });
    return ok({ spec, error: e instanceof Error ? e.message : String(e) });
  }
}
