// Engine → Dialect/Driver resolver. The one place that knows which engines are
// wired. Feature code calls getDialect(conn.engine) / getDriver(conn.engine)
// and never imports a concrete engine module directly, so adding an engine is a
// single edit here plus its implementation folder.
import type { DbEngine } from "@/lib/types";
import { EngineNotSupportedError, type Dialect, type Driver } from "@/app/api/database/driver";
import { postgresDialect } from "@/app/api/database/dialect/postgres";

// Relational SQL-text primitives per engine. MySQL lands in 9B; Mongo never
// gets a dialect (no SQL).
const DIALECTS: Partial<Record<DbEngine, Dialect>> = {
  postgres: postgresDialect,
};

// Full drivers (introspect + I/O) per engine. Postgres wiring moves here during
// the 9A lib→app/api migration; until then getDriver throws for every engine.
const DRIVERS: Partial<Record<DbEngine, Driver>> = {};

export function getDialect(engine: DbEngine): Dialect {
  const d = DIALECTS[engine];
  if (!d) throw new EngineNotSupportedError(engine, "SQL dialect");
  return d;
}

export function getDriver(engine: DbEngine): Driver {
  const d = DRIVERS[engine];
  if (!d) throw new EngineNotSupportedError(engine, "driver");
  return d;
}
