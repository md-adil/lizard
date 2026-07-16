import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { getDashboard, updatePanelLayout } from "@/lib/metadata/store";
import { requireEditor } from "@/lib/auth/session";

const bodySchema = z.object({
  panels: z
    .array(
      z.object({
        id: z.string(),
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        w: z.number().int().min(1).max(12),
        h: z.number().int().min(1),
      }),
    )
    .min(1),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id } = await params;
    const dash = getDashboard(id);
    if (!dash) return fail(new Error("Dashboard not found"));
    const { panels } = bodySchema.parse(await req.json());
    updatePanelLayout(id, panels);
    return ok({ updated: true });
  } catch (e) {
    return fail(e);
  }
}
