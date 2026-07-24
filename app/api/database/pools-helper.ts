// Pool-key format shared by every engine's pool/client cache
// (postgres/pool.ts, mysql/pool.ts, mongo/client.ts). Kept in its own file,
// separate from pools.ts's closePools orchestrator, so those engine files
// depend only downward on this — pools.ts depends on them, not the other way
// around, so there's no import cycle to reason about.
//
// Each connection row is a single physical database, so its id plus role is
// a stable, sufficient identity for a pool — no need to fingerprint
// host/port/database/credentials into the key. Editing a connection's
// host/port/database/credentials doesn't need a new key to pick up the
// change: the connections API closes the pool under this key on update (see
// pools.ts's closePools), so the next lookup just recreates it with the new
// config.
export type Role = "read" | "write";

export function poolKey(connectionId: string, role: Role): string {
  return `${connectionId}:${role}`;
}
