import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { getUserTablePrefs, setUserTablePref } from "@/lib/metadata/store";
import { requireUser } from "@/lib/auth/session";

// Generic per-user, per-table preference blob (view type, group-by, ...) —
// one JSON object per table instead of a dedicated table+route per
// preference. GET returns the whole blob; POST upserts a single key.
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
    return ok(getUserTablePrefs(user.id, connectionId, schema, table));
  } catch (e) {
    return fail(e);
  }
}

const bodySchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await req.json());
    setUserTablePref(user.id, body.connectionId, body.schema, body.table, body.key, body.value);
    return ok({ saved: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
