import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { planQuery } from "@/lib/ai";
import { runGuardedQuery } from "@/lib/execute";
import { requireUser, requireAllReadable, AuthError } from "@/lib/auth/session";

const bodySchema = z.object({
  question: z.string().min(1),
  connections: z.array(z.string()).optional(),
  history: z.array(z.object({ question: z.string(), sql: z.string() })).optional(),
});

export const maxDuration = 60;

export async function POST(req: Request) {
  let plan;
  let user;
  try {
    user = await requireUser();
    const body = bodySchema.parse(await req.json());
    plan = await planQuery(body.question, body.connections, body.history);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
  // Execution failures still return the plan (200) so the UI can show the SQL
  // and let the user edit/re-run — transparency over opacity.
  try {
    // the model may name any connection; enforce the actor can read each one
    await requireAllReadable(plan.connections);
    const result = await runGuardedQuery(
      { target: plan.target, connections: plan.connections, sql: plan.sql, dialect: plan.dialect },
      user.email,
    );
    return ok({ plan, result });
  } catch (e) {
    if (e instanceof AuthError) return ok({ plan, error: e.message });
    return ok({ plan, error: e instanceof Error ? e.message : String(e) });
  }
}
