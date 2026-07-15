import { listLinkedRows } from "@/app/api/data/crud";
import { ok, fail } from "@/lib/api";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = {
  params: Promise<{ connection: string; table: string }>;
};

// Phase 8.5 — M2M linked records. [schema]/[table] here is the JUNCTION
// table; query params describe both FK columns and the other side.
export async function GET(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "read");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const selfFkColumn = url.searchParams.get("selfFkColumn") ?? "";
    const otherFkColumn = url.searchParams.get("otherFkColumn") ?? "";
    const otherSchema = url.searchParams.get("otherSchema") ?? undefined;
    const otherTable = url.searchParams.get("otherTable") ?? "";
    const selfValue = url.searchParams.get("selfValue") ?? "";
    if (!selfFkColumn || !otherFkColumn || !otherTable) {
      return fail(new Error("selfFkColumn, otherFkColumn and otherTable are required"));
    }
    const { rows, total } = await listLinkedRows(
      connection,
      schema,
      table,
      selfFkColumn,
      otherFkColumn,
      otherSchema,
      otherTable,
      selfValue,
    );
    return ok({ rows, total });
  } catch (e) {
    return fail(e);
  }
}
