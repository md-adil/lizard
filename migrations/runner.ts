import type { DatabaseSync } from "node:sqlite";

// A migration only describes the SQL to apply — it never touches a
// DatabaseSync directly. The runner owns opening transactions, executing,
// recording, and rolling back, so that behavior lives in one place.
export interface Migration {
  id: string;
  up(): string | string[];
}

function isDuplicateColumnError(err: unknown): boolean {
  return err instanceof Error && /duplicate column name/i.test(err.message);
}

// Applies any migrations not yet recorded in schema_migrations, each inside
// its own transaction. A migration that fails because it re-adds a column
// already present (e.g. one applied ad-hoc by older code before this runner
// existed) is treated as already-applied rather than as a hard failure.
export function runMigrations(db: DatabaseSync, migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const applied = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((r) => r.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    db.exec("BEGIN");
    try {
      const sql = [migration.up()].flat().join(";\n");
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(migration.id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      if (!isDuplicateColumnError(err)) throw err;
      // Column already exists from before this migration was tracked —
      // record it as applied so we don't retry it forever.
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(migration.id);
    }
  }
}
