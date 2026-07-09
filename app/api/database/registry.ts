// Engine → Dialect/Driver resolver. The one place that knows which engines are
// wired. Feature code calls getDialect(conn.engine) / getDriver(conn.engine)
// and never imports a concrete engine module directly, so adding an engine is a
// single edit here plus its implementation folder.
import type { DbEngine } from "@/lib/types";
import { EngineNotSupportedError, type Dialect, type Driver } from "@/app/api/database/driver";
import { postgresDialect } from "@/app/api/database/postgres/dialect";
import { mysqlDialect } from "@/app/api/database/mysql/dialect";

// Relational SQL-text primitives per engine.
const DIALECTS: Partial<Record<DbEngine, Dialect>> = {
  postgres: postgresDialect,
  mysql: mysqlDialect,
};

// Full drivers (introspect + I/O) per engine.
const DRIVERS: Partial<Record<DbEngine, Driver>> = {
  postgres: {
    engine: "postgres",
    dialect: postgresDialect,
    introspect: async (conn) => {
      const { getConnectionCatalog } = await import("@/lib/introspect/catalog");
      return getConnectionCatalog(conn, true);
    },
    defaultSchema: () => "public",
  },
  mysql: {
    engine: "mysql",
    dialect: mysqlDialect,
    introspect: async (conn) => {
      const { introspectMysql } = await import("@/app/api/database/mysql/introspect");
      return introspectMysql(conn);
    },
    defaultSchema: (conn) => conn.database,
  },
};

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
