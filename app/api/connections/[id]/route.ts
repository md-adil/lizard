import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { deleteConnection, getConnection, updateConnection } from "@/lib/metadata/store";
import { connectionSchema, redact } from "@/lib/connections-shared";
import { invalidateCatalog } from "@/lib/introspect/catalog";
import { testConnection } from "@/lib/db/pools";
import { requireAdmin } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const existing = getConnection(id);
    if (!existing) return fail(new Error("Connection not found"));
    const body = connectionSchema.partial().parse(await req.json());
    const updated = updateConnection(id, {
      ...body,
      writeUser: body.writeUser === undefined ? undefined : body.writeUser || null,
      writePassword: body.writePassword === undefined ? undefined : body.writePassword || null,
      allowedSchemas:
        body.allowedSchemas === undefined ? undefined : body.allowedSchemas?.length ? body.allowedSchemas : null,
    });
    invalidateCatalog(id);
    const status = await testConnection(updated!);
    return ok({ ...redact(updated!), status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    deleteConnection(id);
    invalidateCatalog(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
