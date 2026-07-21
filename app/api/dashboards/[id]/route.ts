import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { deleteDashboard, getDashboard, updateDashboard, listPinnedDashboardIds } from "@/lib/metadata/store";
import { requireUser, requireEditor, filterReadablePanels } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const d = getDashboard(id);
    if (!d) return fail(new Error("Dashboard not found"));
    return ok({ ...filterReadablePanels(user, d), pinned: listPinnedDashboardIds(user.id).has(id) });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    await requireEditor();
    const { id } = await params;
    const body = z
      .object({
        name: z.string().min(1).optional(),
        refreshSeconds: z.number().nullable().optional(),
        variables: z
          .array(
            z.discriminatedUnion("type", [
              z.object({
                name: z.string().regex(/^\w+$/, "Name must be letters, numbers, or underscore"),
                label: z.string(),
                type: z.literal("text"),
                value: z.string(),
              }),
              z.object({
                name: z.string().regex(/^\w+$/, "Name must be letters, numbers, or underscore"),
                label: z.string(),
                type: z.literal("select"),
                source: z.discriminatedUnion("kind", [
                  z.object({
                    kind: z.literal("static"),
                    options: z.array(z.object({ label: z.string(), value: z.string() })),
                  }),
                  z.object({
                    kind: z.literal("query"),
                    target: z.enum(["single", "federated"]),
                    connections: z.array(z.string()).min(1),
                    sql: z.string().min(1),
                    dialect: z.enum(["postgres", "mysql", "duckdb"]),
                    valueField: z.string().nullable(),
                    labelField: z.string().nullable(),
                  }),
                ]),
                value: z.string(),
              }),
              z.object({
                name: z.string().regex(/^\w+$/, "Name must be letters, numbers, or underscore"),
                label: z.string(),
                type: z.literal("daterange"),
                from: z.string(),
                to: z.string(),
                includeTime: z.boolean(),
              }),
            ]),
          )
          .optional(),
      })
      .parse(await req.json());
    updateDashboard(id, body);
    return ok(getDashboard(id));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    await requireEditor();
    const { id } = await params;
    deleteDashboard(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
