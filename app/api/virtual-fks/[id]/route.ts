import { ok, fail } from "@/lib/api";
import { deleteVirtualFk } from "@/lib/metadata/store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    deleteVirtualFk(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
