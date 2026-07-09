import { ok, fail } from "@/lib/api";
import { getRow, updateRow, deleteRow } from "@/lib/data/crud";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = { params: Promise<{ connection: string; table: string }> };

// pk is passed as a JSON object in the `pk` query param (composite keys work).
// keyTransforms optionally maps a subset of those columns to a value
// transform (see VfkPair.transform) for looking up a reference whose join
// isn't an exact match (e.g. case-insensitive).
export async function GET(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "read");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const pk = JSON.parse(url.searchParams.get("pk") ?? "{}");
    const keyTransforms = url.searchParams.get("keyTransforms")
      ? JSON.parse(url.searchParams.get("keyTransforms")!)
      : undefined;
    const result = await getRow(connection, schema, table, pk, keyTransforms);
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
