import { closePools as closePostgresPools } from "./postgres/pool";
import { closePools as closeMysqlPools } from "./mysql/pool";
import { closePools as closeMongoPools } from "./mongo/client";

// Closes a connection's pool(s)/client(s) across every engine. A
// ConnectionConfig row doesn't say which engine's cache might be holding it
// stale at the call site (the connections API acts on the row, not a live
// client), so this just closes all of them rather than dispatching on
// conn.engine. Called from the connections API on update/delete.
export function closePools(connectionId: string): void {
  closePostgresPools(connectionId);
  closeMysqlPools(connectionId);
  closeMongoPools(connectionId);
}
