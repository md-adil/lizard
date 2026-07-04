import { z } from "zod";
import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getUserByEmail, verifyPassword, createSession } from "@/lib/auth/store";
import { setSessionCookie } from "@/lib/auth/cookie";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    const user = getUserByEmail(body.email);
    // constant-ish failure message; don't reveal which part was wrong
    if (!user || user.disabled || !verifyPassword(body.password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const { token } = createSession(user.id);
    const res = NextResponse.json({ user: { id: user.id, email: user.email, role: user.role, name: user.name } });
    setSessionCookie(res, token);
    return res;
  } catch (e) {
    if (e instanceof z.ZodError) return fail(new Error("Email and password are required"));
    return fail(e);
  }
}
