import { ok, fail } from "@/lib/api";
import { getRecordCommentAuthor, deleteRecordComment } from "@/lib/metadata/store";
import { requireUser, AuthError } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string }> };

// A comment may be deleted by its author or an admin.
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const author = getRecordCommentAuthor(id);
    if (author === null) return ok({ deleted: true }); // already gone
    if (author !== user.id && user.role !== "admin") {
      throw new AuthError("You can only delete your own comments", 403);
    }
    deleteRecordComment(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
