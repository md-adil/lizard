import { ok, fail } from "@/lib/api";
import { getRow, updateRow, deleteRow } from "@/lib/data/crud";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = { params: Promise<{ connection: string; table: string }> };

// pk is passed as a JSON object in the `pk` query param (composite keys work).
export async function GET(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "read");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const pk = JSON.parse(url.searchParams.get("pk") ?? "{}");
    const result = await getRow(connection, schema, table, pk);
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "write");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const body = await req.json();
    const row = await updateRow(connection, schema, table, body.pk, body.data, body.expectedUpdatedAt);
    return ok({ row });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "write");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const body = await req.json();
    const result = await deleteRow(connection, schema, table, body.pk);
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
