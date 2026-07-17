import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { getDashboard, setDashboardPinned } from "@/lib/metadata/store";
import { requireUser } from "@/lib/auth/session";

// Pinning is a personal preference — any authenticated user (viewers too) can
// pin dashboards for their own sidebar, hence requireUser not requireEditor.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!getDashboard(id)) return fail(new Error("Dashboard not found"));
    const { pinned } = z.object({ pinned: z.boolean() }).parse(await req.json());
    setDashboardPinned(user.id, id, pinned);
    return ok({ pinned });
  } catch (e) {
    return fail(e);
  }
}
