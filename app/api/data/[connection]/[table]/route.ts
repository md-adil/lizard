import { ok, fail } from "@/lib/api";
import { listRows, createRow } from "@/lib/data/crud";
import type { FilterCondition, Combinator } from "@/lib/data/filters";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = {
  params: Promise<{ connection: string; schema: string; table: string }>;
  searchParams: Promise<{schema: string}>
};

export async function GET(req: Request, { params, searchParams }: Params) {
  try {
    const {schema} = await searchParams;
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "read");
    const url = new URL(req.url);
    const filters: FilterCondition[] = url.searchParams.get("filters")
      ? JSON.parse(url.searchParams.get("filters")!)
      : [];
    const result = await listRows({
      connection,
      schema,
      table,
      page: Number(url.searchParams.get("page") ?? 0),
      pageSize: Number(url.searchParams.get("pageSize") ?? 50),
      sort: url.searchParams.get("sort") ?? undefined,
      sortDir: (url.searchParams.get("sortDir") as "asc" | "desc") ?? undefined,
      filters,
      combinator: (url.searchParams.get("combinator") as Combinator) ?? "and",
      search: url.searchParams.get("search") ?? undefined,
    });
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { connection, schema, table } = await params;
    await requireConnectionAccess(connection, "write");
    const data = await req.json();
    const row = await createRow(connection, schema, table, data);
    return ok({ row }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
