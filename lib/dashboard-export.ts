import { z } from "zod";
import type { ChartSpec, Dashboard, DashboardVariable } from "@/lib/types";

// A dashboard's portable definition — everything needed to recreate it
// elsewhere, and nothing instance-specific (id, createdAt, per-user pin
// state). Panels drop their id/dashboardId for the same reason: a fresh id
// gets assigned on import via the normal "create panel" API call.
export interface DashboardExport {
  version: 1;
  name: string;
  refreshSeconds: number | null;
  variables: DashboardVariable[];
  panels: { spec: ChartSpec; x: number; y: number; w: number; h: number }[];
}

export function toDashboardExport(dash: Dashboard): DashboardExport {
  return {
    version: 1,
    name: dash.name,
    refreshSeconds: dash.refreshSeconds,
    variables: dash.variables,
    panels: dash.panels.map((p) => ({ spec: p.spec, x: p.x, y: p.y, w: p.w, h: p.h })),
  };
}

// Loose, structural-only validation — just enough to drive the import flow
// safely. The actual spec/variable shapes get the real (much stricter)
// validation server-side, from the same zod schemas normal panel creation
// and dashboard PATCH already go through — no point duplicating those here.
const dashboardExportSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  refreshSeconds: z.number().nullable(),
  variables: z.array(z.record(z.string(), z.unknown())),
  panels: z.array(
    z.object({
      spec: z.record(z.string(), z.unknown()),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    }),
  ),
});

export function parseDashboardExport(json: string): DashboardExport {
  return dashboardExportSchema.parse(JSON.parse(json)) as unknown as DashboardExport;
}
