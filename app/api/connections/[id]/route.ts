import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { deleteConnection, getConnection, updateConnection } from "@/lib/metadata/store";
import { connectionBaseSchema, redact } from "@/lib/connections-shared";
import { invalidateCatalog } from "@/lib/introspect/catalog";
import { testConnection } from "@/app/api/database/postgres/pool";
import { closePools } from "@/app/api/database/pools";
import { requireAdmin } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const existing = getConnection(id);
    if (!existing) return fail(new Error("Connection not found"));
    const body = connectionBaseSchema.partial().parse(await req.json());
    const updated = updateConnection(id, {
      ...body,
      writeUser: body.writeUser === undefined ? undefined : body.writeUser || null,
      writePassword: body.writePassword === undefined ? undefined : body.writePassword || null,
      allowedSchemas:
        body.allowedSchemas === undefined ? undefined : body.allowedSchemas?.length ? body.allowedSchemas : null,
    });
    invalidateCatalog(id);
    // Host/port/database/credentials may have just changed but the pool
    // cache key hasn't (it's just id:role) — close the stale pool so the
    // next query opens a fresh one with the new config.
    closePools(id);
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
    closePools(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
