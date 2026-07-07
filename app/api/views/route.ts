import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { listSavedViews, addSavedView } from "@/lib/metadata/store";
import { requireUser } from "@/lib/auth/session";

// Saved views (Phase 8.3): named filter/sort/columns/view-type per table.
// Lizard-side only. A view is visible if shared or owned by the requester.
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
    return ok(listSavedViews(user.id, connectionId, schema, table));
  } catch (e) {
    return fail(e);
  }
}

const configSchema = z.object({
  filterSet: z.unknown().optional(),
  sort: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
  columnVisibility: z.record(z.string(), z.boolean()).optional(),
  viewType: z
    .enum(["table", "kanban", "gallery", "calendar", "tree"])
    .optional(),
  groupBy: z.string().nullable().optional(),
  refreshMs: z.number().optional(),
});

const postSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  name: z.string().min(1).max(120),
  shared: z.boolean().default(true),
  config: configSchema,
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const b = postSchema.parse(await req.json());
    const created = addSavedView({
      ownerId: user.id,
      shared: b.shared,
      connectionId: b.connectionId,
      schema: b.schema,
      table: b.table,
      name: b.name,
      config: b.config,
    });
    return ok(created, { status: 201 });
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
