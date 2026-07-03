import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { deletePanel, updatePanel } from "@/lib/metadata/store";
import type { ChartSpec } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { spec?: ChartSpec; x?: number; y?: number; w?: number; h?: number };
    updatePanel(id, body);
    return ok({ updated: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    deletePanel(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
