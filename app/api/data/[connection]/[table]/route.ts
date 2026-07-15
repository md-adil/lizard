import { ok, fail } from "@/lib/api";
import { listRows, listGroupedRows, createRow } from "@/app/api/data/crud";
import type { FilterCondition, Combinator } from "@/lib/data/filters";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = {
  params: Promise<{ connection: string; table: string }>;
};

export async function GET(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "read");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const filters: FilterCondition[] = url.searchParams.get("filters")
      ? JSON.parse(url.searchParams.get("filters")!)
      : [];
    const sort = url.searchParams.get("sort") ?? undefined;
    const sortDir = (url.searchParams.get("sortDir") as "asc" | "desc") ?? undefined;
    const combinator = (url.searchParams.get("combinator") as Combinator) ?? "and";
    const search = url.searchParams.get("search") ?? undefined;

    // Kanban/Calendar ask for a fair top-N per distinct group (column value,
    // or calendar day) instead of one flat page — see listGroupedRows.
    const groupBy = url.searchParams.get("groupBy") ?? undefined;
    if (groupBy) {
      const result = await listGroupedRows({
        connection,
        schema,
        table,
        groupBy,
        groupKind: url.searchParams.get("groupKind") === "day" ? "day" : "value",
        perGroup: Number(url.searchParams.get("perGroup") ?? 50),
        maxGroups: Number(url.searchParams.get("maxGroups") ?? 50),
        sort,
        sortDir,
        filters,
        combinator,
        search,
      });
      return ok(result);
    }

    const result = await listRows({
      connection,
      schema,
      table,
      page: Number(url.searchParams.get("page") ?? 0),
      pageSize: Number(url.searchParams.get("pageSize") ?? 50),
      sort,
      sortDir,
      filters,
      combinator,
      search,
    });
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "write");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const data = await req.json();
    const row = await createRow(connection, schema, table, data);
    return ok({ row }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
