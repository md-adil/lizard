import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { listGrants, setGrant, getUserById } from "@/lib/auth/store";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  connectionId: z.string(),
  access: z.enum(["read", "write"]).nullable(), // null revokes
});

export async function GET(_req: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    return ok(listGrants(id));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    if (!getUserById(id)) return fail(new Error("User not found"));
    const body = schema.parse(await req.json());
    setGrant(id, body.connectionId, body.access);
    return ok(listGrants(id));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.errors.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
