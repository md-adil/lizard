import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { updateUser, deleteUser, getUserById, listUsers } from "@/lib/auth/store";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().nullable().optional(),
  role: z.enum(["admin", "editor", "viewer"]).optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const target = getUserById(id);
    if (!target) return fail(new Error("User not found"));
    const body = patchSchema.parse(await req.json());
    // don't let an admin demote/disable the last remaining admin (or themselves into lockout)
    if ((body.role && body.role !== "admin") || body.disabled) {
      const admins = listUsers().filter((u) => u.role === "admin" && !u.disabled);
      if (target.role === "admin" && admins.length <= 1) {
        return fail(new Error("Cannot demote or disable the last admin"));
      }
    }
    void admin;
    const updated = updateUser(id, body);
    return ok(updated);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.errors.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    if (id === admin.id) return fail(new Error("You cannot delete your own account"));
    deleteUser(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
