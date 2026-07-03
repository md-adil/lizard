import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { planQuery } from "@/lib/ai";
import { runGuardedQuery } from "@/lib/execute";

const bodySchema = z.object({
  question: z.string().min(1),
  connections: z.array(z.string()).optional(),
  history: z.array(z.object({ question: z.string(), sql: z.string() })).optional(),
});

export const maxDuration = 60;

export async function POST(req: Request) {
  let plan;
  try {
    const body = bodySchema.parse(await req.json());
    plan = await planQuery(body.question, body.connections, body.history);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.errors.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
  // Execution failures still return the plan (200) so the UI can show the SQL
  // and let the user edit/re-run — transparency over opacity.
  try {
    const result = await runGuardedQuery({
      target: plan.target,
      connections: plan.connections,
      sql: plan.sql,
      dialect: plan.dialect,
    });
    return ok({ plan, result });
  } catch (e) {
    return ok({ plan, error: e instanceof Error ? e.message : String(e) });
  }
}
