import { ok, fail } from "@/lib/api";
import { getSavedViewOwner, deleteSavedView } from "@/lib/metadata/store";
import { requireUser, AuthError } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string }> };

// A saved view may be deleted by its owner or an admin.
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const owner = getSavedViewOwner(id);
    if (owner === null) return ok({ deleted: true });
    if (owner !== user.id && user.role !== "admin") {
      throw new AuthError("You can only delete your own views", 403);
    }
    deleteSavedView(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
