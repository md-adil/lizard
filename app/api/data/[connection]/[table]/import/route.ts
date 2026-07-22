import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { bulkInsertRows } from "@/app/api/data/crud";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = {
  params: Promise<{ connection: string; table: string }>;
};

// Phase 8.7 — CSV import. The client parses the file and maps columns; this
// route just bulk-inserts the already-mapped row objects.
const bodySchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
});

export async function POST(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "write");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const { rows } = bodySchema.parse(await req.json());
    const result = await bulkInsertRows(connection, schema, table, rows);
    return ok(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
