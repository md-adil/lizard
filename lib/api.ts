import { NextResponse } from "next/server";
import { GuardError } from "@/lib/guard/guard";
import { CrudError } from "@/app/api/data/crud";
import { AuthError } from "@/lib/auth/session";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(e: unknown): NextResponse {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof CrudError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof GuardError) return NextResponse.json({ error: e.message, guard: true }, { status: 400 });
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: message }, { status: 500 });
}
