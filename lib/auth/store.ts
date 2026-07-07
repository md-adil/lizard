// Auth data layer: users, sessions, per-connection grants. Passwords hashed
// with scrypt (node:crypto, no external deps). Sessions are opaque random
// tokens stored server-side.
import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { getMetaDb } from "@/lib/metadata/store";

export type Role = "admin" | "editor" | "viewer";
export type Access = "read" | "write";

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

const SESSION_TTL_DAYS = 30;

// ---------- password hashing ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const dk = scryptSync(password, salt, expected.length);
  return expected.length === dk.length && timingSafeEqual(expected, dk);
}

// ---------- users ----------

function rowToUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string,
    email: r.email as string,
    name: (r.name as string) || null,
    role: r.role as Role,
    disabled: !!r.disabled,
    createdAt: r.created_at as string,
  };
}

export function userCount(): number {
  return (getMetaDb().prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
}

export function listUsers(): User[] {
  const rows = getMetaDb().prepare("SELECT * FROM users ORDER BY created_at").all() as Record<string, unknown>[];
  return rows.map(rowToUser);
}

export function getUserById(id: string): User | null {
  const r = getMetaDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? rowToUser(r) : null;
}

export function getUserByEmail(email: string): (User & { passwordHash: string }) | null {
  const r = getMetaDb().prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as
    Record<string, unknown> | undefined;
  return r ? { ...rowToUser(r), passwordHash: r.password_hash as string } : null;
}

export function createUser(input: { email: string; password: string; name?: string | null; role: Role }): User {
  const id = randomUUID();
  getMetaDb()
    .prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)")
    .run(id, input.email.toLowerCase(), input.name ?? null, hashPassword(input.password), input.role);
  return getUserById(id)!;
}

export function updateUser(
  id: string,
  fields: { name?: string | null; role?: Role; disabled?: boolean; password?: string },
): User | null {
  const u = getUserById(id);
  if (!u) return null;
  const db = getMetaDb();
  if (fields.name !== undefined) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(fields.name, id);
  if (fields.role !== undefined) db.prepare("UPDATE users SET role = ? WHERE id = ?").run(fields.role, id);
  if (fields.disabled !== undefined)
    db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(fields.disabled ? 1 : 0, id);
  if (fields.password)
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(fields.password), id);
  return getUserById(id);
}

export function deleteUser(id: string): void {
  const db = getMetaDb();
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM connection_grants WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

// ---------- sessions ----------

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
  getMetaDb()
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function getSessionUser(token: string | undefined): User | null {
  if (!token) return null;
  const row = getMetaDb().prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").get(token) as
    { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(token);
    return null;
  }
  const user = getUserById(row.user_id);
  if (!user || user.disabled) return null;
  return user;
}

export function deleteSession(token: string): void {
  getMetaDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// ---------- grants ----------

export function listGrants(userId: string): { connectionId: string; access: Access }[] {
  const rows = getMetaDb()
    .prepare("SELECT connection_id, access FROM connection_grants WHERE user_id = ?")
    .all(userId) as { connection_id: string; access: Access }[];
  return rows.map((r) => ({ connectionId: r.connection_id, access: r.access }));
}

export function setGrant(userId: string, connectionId: string, access: Access | null): void {
  const db = getMetaDb();
  if (access === null) {
    db.prepare("DELETE FROM connection_grants WHERE user_id = ? AND connection_id = ?").run(userId, connectionId);
    return;
  }
  db.prepare(
    `INSERT INTO connection_grants (user_id, connection_id, access) VALUES (?, ?, ?)
     ON CONFLICT (user_id, connection_id) DO UPDATE SET access = excluded.access`,
  ).run(userId, connectionId, access);
}

// Effective permissions. Admins bypass grants; viewers can never write.
export function canRead(user: User, connectionId: string): boolean {
  if (user.role === "admin") return true;
  return listGrants(user.id).some((g) => g.connectionId === connectionId);
}

export function canWrite(user: User, connectionId: string): boolean {
  if (user.role === "viewer") return false;
  if (user.role === "admin") return true;
  return listGrants(user.id).some((g) => g.connectionId === connectionId && g.access === "write");
}

export function readableConnectionIds(user: User): "all" | Set<string> {
  if (user.role === "admin") return "all";
  return new Set(listGrants(user.id).map((g) => g.connectionId));
}
