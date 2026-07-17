import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { addDashboard, listDashboards, listPinnedDashboardIds } from "@/lib/metadata/store";
import { requireUser, requireEditor, filterReadablePanels } from "@/lib/auth/session";

export async function GET() {
  try {
    const user = await requireUser();
    const pinned = listPinnedDashboardIds(user.id);
    return ok(listDashboards().map((d) => ({ ...filterReadablePanels(user, d), pinned: pinned.has(d.id) })));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireEditor();
    const body = z
      .object({ name: z.string().min(1), refreshSeconds: z.number().nullable().optional() })
      .parse(await req.json());
    return ok(addDashboard(body.name, body.refreshSeconds ?? null), { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
