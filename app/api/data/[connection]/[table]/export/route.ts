import { exportRows } from "@/app/api/data/crud";
import type { FilterCondition, Combinator } from "@/lib/data/filters";
import { requireConnectionAccess } from "@/lib/auth/session";

type Params = {
  params: Promise<{ connection: string; table: string }>;
};

// RFC-4180-ish field quoting: wrap in quotes and double embedded quotes when
// the value contains a comma, quote, or newline.
function csvField(v: unknown): string {
  let s: string;
  if (v === null || v === undefined) s = "";
  else if (typeof v === "object") {
    const o = v as { type?: string; data?: unknown[] };
    s =
      o.type === "Buffer" && Array.isArray(o.data)
        ? `\\x[${o.data.length} bytes]`
        : JSON.stringify(v);
  } else s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request, { params }: Params) {
  try {
    const { connection, table } = await params;
    await requireConnectionAccess(connection, "read");
    const url = new URL(req.url);
    const schema = url.searchParams.get("schema") ?? undefined;
    const filters: FilterCondition[] = url.searchParams.get("filters")
      ? JSON.parse(url.searchParams.get("filters")!)
      : [];
    const { columns, rows, truncated } = await exportRows({
      connection,
      schema,
      table,
      sort: url.searchParams.get("sort") ?? undefined,
      sortDir: (url.searchParams.get("sortDir") as "asc" | "desc") ?? undefined,
      filters,
      combinator: (url.searchParams.get("combinator") as Combinator) ?? "and",
      search: url.searchParams.get("search") ?? undefined,
    });

    const lines = [
      columns.map(csvField).join(","),
      ...rows.map((r) => columns.map((c) => csvField(r[c])).join(",")),
    ];
    const csv = lines.join("\r\n");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${schema ? `${schema}.` : ""}${table}.csv"`,
        ...(truncated ? { "X-Export-Truncated": "true" } : {}),
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Export failed" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
}
