import { ok, fail } from "@/lib/api";
import { listAudit } from "@/lib/metadata/store";

export async function GET() {
  try {
    return ok(listAudit());
  } catch (e) {
    return fail(e);
  }
}
