import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { listRecordComments, addRecordComment, canonicalPkKey } from "@/lib/metadata/store";
import { requireUser } from "@/lib/auth/session";

// Per-record comments (Phase 8.9). Lizard-side only; the target DB is never
// touched. Keyed by a canonical PK string so any caller referencing the same
// row sees the same thread.
export async function GET(req: Request) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const connectionId = url.searchParams.get("connectionId") ?? "";
    const schema = url.searchParams.get("schema") ?? "";
    const table = url.searchParams.get("table") ?? "";
    const pkRaw = url.searchParams.get("pk");
    if (!connectionId || !schema || !table || !pkRaw) {
      return fail(new Error("connectionId, schema, table and pk are required"));
    }
    const pkKey = canonicalPkKey(JSON.parse(pkRaw));
    return ok(listRecordComments(connectionId, schema, table, pkKey));
  } catch (e) {
    return fail(e);
  }
}

const postSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  pk: z.record(z.string(), z.unknown()),
  body: z.string().min(1).max(10_000),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const b = postSchema.parse(await req.json());
    const created = addRecordComment({
      authorId: user.id,
      authorName: user.name ?? user.email,
      connectionId: b.connectionId,
      schema: b.schema,
      table: b.table,
      pkKey: canonicalPkKey(b.pk),
      body: b.body,
    });
    return ok(created, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
