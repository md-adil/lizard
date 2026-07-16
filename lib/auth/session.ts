// Request-side auth helpers used by API routes. Reads the session cookie,
// resolves the user, and enforces role / per-connection access. Throws
// AuthError (caught by lib/api `fail`) so routes stay one-liners.
import { cookies } from "next/headers";
import type { User, Access } from "@/lib/auth/store";
import { getSessionUser, canRead, canWrite, getUserById, readableConnectionIds } from "@/lib/auth/store";
import { getConnection } from "@/lib/metadata/store";
import type { Dashboard } from "@/lib/types";

export const SESSION_COOKIE = "lizard_session";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  return getSessionUser(store.get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthError("Not authenticated", 401);
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("Admin access required", 403);
  return user;
}

export async function requireEditor(): Promise<User> {
  const user = await requireUser();
  if (user.role === "viewer") throw new AuthError("Editor access required", 403);
  return user;
}

// Resolve a connection by name and assert the actor may read (or write) it.
export async function requireConnectionAccess(connectionName: string, level: Access = "read"): Promise<User> {
  const user = await requireUser();
  const conn = getConnection(connectionName);
  if (!conn) throw new AuthError(`Unknown connection: ${connectionName}`, 404);
  const ok = level === "write" ? canWrite(user, conn.id) : canRead(user, conn.id);
  if (!ok) throw new AuthError(`You do not have ${level} access to "${connectionName}"`, 403);
  return user;
}

// For federated/multi-connection requests: every named connection must be readable.
export async function requireAllReadable(connectionNames: string[]): Promise<User> {
  const user = await requireUser();
  for (const name of connectionNames) {
    const conn = getConnection(name);
    if (!conn) throw new AuthError(`Unknown connection: ${name}`, 404);
    if (!canRead(user, conn.id)) throw new AuthError(`You do not have read access to "${name}"`, 403);
  }
  return user;
}

// Dashboard reads aren't gated by role (any authenticated user can list/view
// dashboards), but a panel's SQL/connection names shouldn't leak to someone
// who can't read the connection it targets — the same per-connection check
// panel *refresh* already enforces (requireAllReadable, at /api/query time)
// has to apply at dashboard *read* time too, or listing/opening a dashboard
// is an end-run around it.
export function filterReadablePanels(user: User, dashboard: Dashboard): Dashboard {
  const readable = readableConnectionIds(user);
  if (readable === "all") return dashboard;
  return {
    ...dashboard,
    panels: dashboard.panels.filter((p) =>
      p.spec.connections.every((name) => {
        const conn = getConnection(name);
        return !!conn && readable.has(conn.id);
      }),
    ),
  };
}

export { getUserById };
