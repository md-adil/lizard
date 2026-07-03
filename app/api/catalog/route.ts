import { ok, fail } from "@/lib/api";
import { getCatalog, invalidateCatalog } from "@/lib/introspect/catalog";
import { listTableOverrides, listColumnOverrides } from "@/lib/metadata/store";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("refresh")) invalidateCatalog();
    const catalog = await getCatalog();
    return ok({
      ...catalog,
      tableOverrides: listTableOverrides(),
      columnOverrides: listColumnOverrides(),
    });
  } catch (e) {
    return fail(e);
  }
}
