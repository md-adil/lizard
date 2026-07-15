// Target database engine. Postgres is the original; MySQL is a relational
// sibling (Phase 9B); Mongo is a document store (Phase 9D). The `schema`
// level is always present internally — non-Postgres engines report a synthetic
// schema (MySQL: the database name; Mongo: "default").
export type DbEngine = "postgres" | "mysql" | "mongo";

export const DB_ENGINES: DbEngine[] = ["postgres", "mysql", "mongo"];

// Only Postgres exposes a real, independently-named schema namespace; MySQL
// reports the database name and Mongo "default" as a single synthetic
// schema. Mirrors Dialect.supportsSchemas (app/api/database/driver.ts) —
// that one lives server-side per SQL dialect, this is the same fact as a
// plain function of DbEngine so client code can use it without pulling in
// driver/dialect implementations.
export function supportsSchemas(engine: DbEngine): boolean {
  return engine === "postgres";
}

// Default TCP port per engine, used when a connection omits one.
export const DEFAULT_PORTS: Record<DbEngine, number> = {
  postgres: 5432,
  mysql: 3306,
  mongo: 27017,
};

export interface ConnectionConfig {
  id: string;
  name: string; // unique slug-ish label, used as the federation alias
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  readUser: string;
  readPassword: string;
  writeUser: string | null;
  writePassword: string | null;
  ssl: boolean;
  allowedSchemas: string[] | null; // null = all non-system schemas
  // Extra driver connection options as a URL query string (no leading "?"),
  // e.g. "authSource=admin&replicaSet=rs0&readPreference=secondary". Preserved
  // from a pasted URI and re-applied when building the driver connection string.
  // Consumed by the MongoDB driver (where authSource/directConnection matter);
  // ignored by the relational engines. null = none.
  options: string | null;
  // Taken offline by an admin — hidden from Browse/the catalog and rejected by
  // the query layer, but kept (and its customizations) for later re-enabling.
  disabled: boolean;
  createdAt: string;
}

// disabled defaults to false (the DB column has DEFAULT 0) so callers that
// only ever create enabled connections — like most call sites — don't need
// to know about the flag.
export type ConnectionInput = Omit<ConnectionConfig, "id" | "createdAt" | "disabled"> & { disabled?: boolean };
