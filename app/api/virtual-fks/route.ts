import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { addVirtualFk, listVirtualFks } from "@/lib/metadata/store";
import { requireUser, requireEditor } from "@/lib/auth/session";

const pairSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  transform: z.enum(["none", "lower", "upper", "trim"]).default("none"),
});

const constantSchema = z.object({
  toColumn: z.string().min(1),
  side: z.enum(["source", "target"]),
  value: z.string(),
});

const vfkSchema = z.object({
  fromConnection: z.string().min(1),
  fromSchema: z.string().min(1),
  fromTable: z.string().min(1),
  toConnection: z.string().min(1),
  toSchema: z.string().min(1),
  toTable: z.string().min(1),
  pairs: z.array(pairSchema).min(1),
  constants: z.array(constantSchema).default([]),
  label: z.string().nullable().default(null),
  joinHint: z.string().nullable().default(null),
});

export async function GET() {
  try {
    await requireUser();
    return ok(listVirtualFks());
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireEditor();
    const body = vfkSchema.parse(await req.json());
    return ok(addVirtualFk(body), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
