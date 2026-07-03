import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { deleteDashboard, getDashboard, updateDashboard } from "@/lib/metadata/store";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const d = getDashboard(id);
  if (!d) return fail(new Error("Dashboard not found"));
  return ok(d);
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = z
      .object({ name: z.string().min(1).optional(), refreshSeconds: z.number().nullable().optional() })
      .parse(await req.json());
    updateDashboard(id, body);
    return ok(getDashboard(id));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  deleteDashboard(id);
  return ok({ deleted: true });
}
