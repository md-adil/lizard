import { ok, fail } from "@/lib/api";
import { deleteSavedQuery } from "@/lib/metadata/store";
import { requireUser } from "@/lib/auth/session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    deleteSavedQuery(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
