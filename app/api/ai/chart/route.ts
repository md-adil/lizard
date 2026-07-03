import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { planChart } from "@/lib/ai";
import { runGuardedQuery } from "@/lib/execute";

const bodySchema = z.object({
  prompt: z.string().min(1),
  connections: z.array(z.string()).optional(),
});

export const maxDuration = 60;

export async function POST(req: Request) {
  let spec;
  try {
    const body = bodySchema.parse(await req.json());
    spec = await planChart(body.prompt, body.connections);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.errors.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
  try {
    const result = await runGuardedQuery({
      target: spec.target,
      connections: spec.connections,
      sql: spec.sql,
      dialect: spec.dialect,
    });
    return ok({ spec, result });
  } catch (e) {
    return ok({ spec, error: e instanceof Error ? e.message : String(e) });
  }
}
