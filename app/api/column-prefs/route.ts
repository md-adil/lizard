import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { getUserColumnPrefs, setUserColumnPref } from "@/lib/metadata/store";
import { requireUser } from "@/lib/auth/session";

// One user's personal "Columns" visibility toggle for the grid — distinct
// from /api/overrides, which is a shared structural hide applied for every
// user across every surface.
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const connectionId = url.searchParams.get("connectionId") ?? "";
    const schema = url.searchParams.get("schema") ?? "";
    const table = url.searchParams.get("table") ?? "";
    if (!connectionId || !schema || !table) {
      return fail(new Error("connectionId, schema and table are required"));
    }
    return ok(getUserColumnPrefs(user.id, connectionId, schema, table));
  } catch (e) {
    return fail(e);
  }
}

const bodySchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  column: z.string().min(1),
  hidden: z.boolean(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await req.json());
    setUserColumnPref(
      user.id,
      body.connectionId,
      body.schema,
      body.table,
      body.column,
      body.hidden,
    );
    return ok({ saved: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(
        new Error(
          e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        ),
      );
    }
    return fail(e);
  }
}
