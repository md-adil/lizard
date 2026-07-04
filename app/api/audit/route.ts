import { ok, fail } from "@/lib/api";
import { listAudit } from "@/lib/metadata/store";
import { requireAdmin } from "@/lib/auth/session";

export async function GET() {
  try {
    await requireAdmin();
    return ok(listAudit());
  } catch (e) {
    return fail(e);
  }
}
