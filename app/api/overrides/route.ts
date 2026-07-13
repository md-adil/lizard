import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { listTableOverrides, listColumnOverrides, setTableOverride, setColumnOverride } from "@/lib/metadata/store";
import { requireUser, requireEditor } from "@/lib/auth/session";
import { invalidateSearchTargets } from "@/lib/data/global-search";

const tableOverrideSchema = z.object({
  kind: z.literal("table"),
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  hidden: z.boolean().default(false),
  displayColumn: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
  primaryKey: z.array(z.string()).nullable().default(null),
  searchable: z.boolean().default(false),
  defaultSort: z.string().nullable().default(null),
  defaultSortDir: z.enum(["asc", "desc"]).nullable().default(null),
});

const columnOverrideSchema = z.object({
  kind: z.literal("column"),
  connectionId: z.string(),
  schema: z.string(),
  table: z.string(),
  column: z.string(),
  label: z.string().nullable().default(null),
  widget: z.string().nullable().default(null),
  hidden: z.boolean().default(false),
  hiddenInGrid: z.boolean().default(false),
  readonly: z.boolean().default(false),
  redacted: z.boolean().default(false),
  sortOrder: z.number().nullable().default(null),
  help: z.string().nullable().default(null),
  options: z.array(z.string()).nullable().default(null),
  optionLabels: z.record(z.string(), z.string()).nullable().default(null),
});

export async function GET() {
  try {
    await requireUser();
    return ok({ tables: listTableOverrides(), columns: listColumnOverrides() });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireEditor();
    const body = z.discriminatedUnion("kind", [tableOverrideSchema, columnOverrideSchema]).parse(await req.json());
    if (body.kind === "table") {
      setTableOverride(body);
      // the resolved searchable-table cache doesn't know this specific write
      // just changed the flag it's keyed on — cheap to blow away entirely
      // since it rebuilds lazily on the next search anyway.
      invalidateSearchTargets();
    } else {
      setColumnOverride(body);
    }
    return ok({ saved: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
