import { ok, fail } from "@/lib/api";
import { columnSuggestions } from "@/app/api/data/crud";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = { params: Promise<{ connection: string; table: string }> };

// Autocomplete suggestions: GET ?column=<column>&q=<search>&mode=<contains|prefix>
// — distinct existing values of that column, for the "autocomplete" widget.
// mode=prefix is the filter panel's indexed "is" autocomplete (see
// columnSuggestions in app/api/data/crud.ts) — omit for the default contains match.
export async function GET(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "read");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const column = url.searchParams.get("column");
    if (!column) return fail(new Error("column query param is required"));
    const mode = url.searchParams.get("mode") === "prefix" ? "prefix" : "contains";
    const options = await columnSuggestions(connection, schema, table, column, url.searchParams.get("q") ?? "", mode);
    return ok(options);
  } catch (e) {
    return fail(e);
  }
}
