import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { listUsers, createUser, getUserByEmail, listGrants } from "@/lib/auth/store";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  role: z.enum(["admin", "editor", "viewer"]),
});

export async function GET() {
  try {
    await requireAdmin();
    const users = listUsers().map((u) => ({ ...u, grants: listGrants(u.id) }));
    return ok(users);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = createSchema.parse(await req.json());
    if (getUserByEmail(body.email)) return fail(new Error("A user with that email already exists"));
    const user = createUser(body);
    return ok(user, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.errors.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
