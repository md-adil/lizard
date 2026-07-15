import { ok, fail } from "@/lib/api";
import { distinctColumnValues } from "@/app/api/data/crud";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = { params: Promise<{ connection: string; table: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "read");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const column = url.searchParams.get("column");
    if (!column) return fail(new Error("column query param is required"));
    const options = await distinctColumnValues(connection, schema, table, column, url.searchParams.get("q") ?? "");
    return ok(options);
  } catch (e) {
    return fail(e);
  }
}
