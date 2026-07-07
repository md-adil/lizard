import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser, requireUser, SESSION_COOKIE } from "@/lib/auth/session";
import { updateUser, verifyPassword } from "@/lib/auth/store";
import { getMetaDb } from "@/lib/metadata/store";
import { clearSessionCookie } from "@/lib/auth/cookie";
import { fail, ok } from "@/lib/api";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    const res = NextResponse.json({ user: null }, { status: 200 });
    if ((await cookies()).has(SESSION_COOKIE)) clearSessionCookie(res);
    return res;
  }
  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const fields: { name?: string | null; password?: string } = {};

    if ("name" in body) {
      fields.name = body.name?.trim() || null;
    }

    if (body.newPassword) {
      if (!body.currentPassword) throw new Error("Current password is required to set a new password");
      if (body.newPassword.length < 8) throw new Error("New password must be at least 8 characters");
      const row = getMetaDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as
        { password_hash: string } | undefined;
      if (!row || !verifyPassword(body.currentPassword, row.password_hash))
        throw new Error("Current password is incorrect");
      fields.password = body.newPassword;
    }

    const updated = updateUser(user.id, fields);
    return ok({
      user: updated
        ? {
            id: updated.id,
            email: updated.email,
            name: updated.name,
            role: updated.role,
          }
        : null,
    });
  } catch (e) {
    return fail(e);
  }
}
