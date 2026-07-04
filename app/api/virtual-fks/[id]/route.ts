import { ok, fail } from "@/lib/api";
import { deleteVirtualFk } from "@/lib/metadata/store";
import { requireEditor } from "@/lib/auth/session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id } = await params;
    deleteVirtualFk(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
