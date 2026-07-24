// Federation engine: an embedded DuckDB that ATTACHes multiple Postgres
// databases READ_ONLY (with each connection's *read* credentials) and runs one
// cross-database SELECT. No DDL ever touches the user's databases. Lizard
// issues the attachments itself — model SQL that tries to ATTACH/INSTALL/etc.
// is rejected by the guard before it gets here.
import { DuckDBInstance } from "@duckdb/node-api";
import type { ConnectionConfig, QueryResult } from "@/lib/types";
import { connectionUri } from "@/app/api/database/postgres/pool";
import { MAX_ROWS } from "@/lib/guard/guard";

import { quoteIdentifier, quoteLiteral } from "@/lib/utils";

const FEDERATED_TIMEOUT_MS = 20_000;

export async function runFederated(
  connections: ConnectionConfig[],
  wrappedSql: string,
  originalSql: string,
): Promise<QueryResult> {
  const started = Date.now();
  const instance = await DuckDBInstance.create(":memory:");
  const db = await instance.connect();
  try {
    await db.run("INSTALL postgres; LOAD postgres;");
    await db.run("INSTALL mysql; LOAD mysql;");
    for (const conn of connections) {
      const type = conn.engine === "mysql" ? "mysql" : "postgres";
      await db.run(
        `ATTACH ${quoteLiteral(connectionUri(conn, "read"))} AS ${quoteIdentifier(conn.name)} (TYPE ${type}, READ_ONLY)`,
      );
    }
    // lock the sandbox: no filesystem, no further configuration changes
    await db.run("SET disabled_filesystems='LocalFileSystem'");
    await db.run("SET lock_configuration=true");

    const timer = setTimeout(() => {
      try {
        db.interrupt();
      } catch {
        /* already finished */
      }
    }, FEDERATED_TIMEOUT_MS);

    try {
      const reader = await db.runAndReadAll(wrappedSql);
      const columnNames = reader.columnNames();
      const columnTypes = reader.columnTypes().map((t) => String(t));
      const rawRows = reader.getRowObjectsJson() as Record<string, unknown>[];
      const truncated = rawRows.length > MAX_ROWS;
      const rows = truncated ? rawRows.slice(0, MAX_ROWS) : rawRows;
      return {
        columns: columnNames.map((name, i) => ({ name, type: columnTypes[i]?.toLowerCase() ?? "unknown" })),
        rows,
        rowCount: rows.length,
        truncated,
        durationMs: Date.now() - started,
        connections: connections.map((c) => c.name),
        sql: originalSql,
      };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      db.closeSync();
    } catch {
      /* noop */
    }
  }
}
