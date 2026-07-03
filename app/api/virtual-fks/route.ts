import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { addVirtualFk, listVirtualFks } from "@/lib/metadata/store";

const vfkSchema = z.object({
  fromConnection: z.string().min(1),
  fromSchema: z.string().min(1),
  fromTable: z.string().min(1),
  fromColumn: z.string().min(1),
  toConnection: z.string().min(1),
  toSchema: z.string().min(1),
  toTable: z.string().min(1),
  toColumn: z.string().min(1),
  label: z.string().nullable().default(null),
});

export async function GET() {
  return ok(listVirtualFks());
}

export async function POST(req: Request) {
  try {
    const body = vfkSchema.parse(await req.json());
    return ok(addVirtualFk(body), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.errors.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
