import { ok, fail } from "@/lib/api";
import { listAudit, countAudit } from "@/lib/metadata/store";
import { requireAdmin } from "@/lib/auth/session";

const MAX_PAGE_SIZE = 200;

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get("pageSize")) || 50));
    const total = countAudit();
    const rows = listAudit(pageSize, page * pageSize);
    return ok({ rows, total, hasMore: (page + 1) * pageSize < total });
  } catch (e) {
    return fail(e);
  }
}
