import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { addDashboard, listDashboards } from "@/lib/metadata/store";

export async function GET() {
  return ok(listDashboards());
}

export async function POST(req: Request) {
  try {
    const body = z
      .object({ name: z.string().min(1), refreshSeconds: z.number().nullable().optional() })
      .parse(await req.json());
    return ok(addDashboard(body.name, body.refreshSeconds ?? null), { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
