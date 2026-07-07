// First-run setup: create the initial admin. Only works while zero users exist,
// so it can't be used to escalate later.
import { z } from "zod";
import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { userCount, createUser, createSession } from "@/lib/auth/store";
import { setSessionCookie } from "@/lib/auth/cookie";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
  name: z.string().optional(),
});

export async function GET() {
  return NextResponse.json({ needsSetup: userCount() === 0 });
}

export async function POST(req: Request) {
  try {
    if (userCount() > 0) return fail(new Error("Setup already completed"));
    const body = schema.parse(await req.json());
    const user = createUser({ email: body.email, password: body.password, name: body.name ?? null, role: "admin" });
    const { token } = createSession(user.id);
    const res = NextResponse.json(
      { user: { id: user.id, email: user.email, role: user.role, name: user.name } },
      { status: 201 },
    );
    setSessionCookie(res, token);
    return res;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return fail(e);
  }
}
