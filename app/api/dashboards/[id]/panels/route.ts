import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { addPanel, getDashboard } from "@/lib/metadata/store";
import type { ChartSpec, ChartType } from "@/lib/types";
import { CHART_TYPES } from "@/lib/types";
import { requireEditor } from "@/lib/auth/session";

const CHART_TYPE_KEYS = Object.keys(CHART_TYPES) as [ChartType, ...ChartType[]];

const specSchema = z.object({
  title: z.string(),
  chartType: z.enum(CHART_TYPE_KEYS),
  target: z.enum(["single", "federated"]),
  connections: z.array(z.string()).min(1),
  sql: z.string().min(1),
  dialect: z.enum(["postgres", "mysql", "duckdb"]),
  xField: z.string().nullable(),
  yFields: z.array(z.string()),
  seriesField: z.string().nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id } = await params;
    const dash = getDashboard(id);
    if (!dash) return fail(new Error("Dashboard not found"));
    const body = z
      .object({
        spec: specSchema,
        pos: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
      })
      .parse(await req.json());
    const maxY = dash.panels.reduce((m, p) => Math.max(m, p.y + p.h), 0);
    const panel = addPanel(id, body.spec as ChartSpec, body.pos ?? { x: 0, y: maxY, w: 6, h: 8 });
    return ok(panel, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
