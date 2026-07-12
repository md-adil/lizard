// Parse a database connection string into Lizard connection fields, using the
// WHATWG URL parser. Handles postgres://, mysql://, and mongodb:// (+srv),
// url-encoded credentials, an optional port, and sslmode.
import { DEFAULT_PORTS, type DbEngine } from "@/lib/types";

export interface ParsedUri {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  name: string; // suggested identifier derived from the database name
}

const SCHEME_ENGINE: Record<string, DbEngine> = {
  "postgres:": "postgres",
  "postgresql:": "postgres",
  "mysql:": "mysql",
  "mongodb:": "mongo",
  "mongodb+srv:": "mongo",
};

export function parseConnectionUri(raw: string): ParsedUri | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const engine = SCHEME_ENGINE[u.protocol];
  if (!engine) return null;
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const sslmode = u.searchParams.get("sslmode");
  const sslQuery = u.searchParams.get("ssl");
  // mongodb+srv implies TLS; otherwise honor an explicit sslmode or ssl parameter.
  const ssl =
    u.protocol === "mongodb+srv:" ||
    sslmode === "require" ||
    sslmode === "verify-full" ||
    sslmode === "verify-ca" ||
    sslmode === "true" ||
    sslQuery === "true";
  return {
    engine,
    host: u.hostname || "localhost",
    port: u.port ? Number(u.port) : DEFAULT_PORTS[engine],
    database,
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    ssl,
    name: (database || "db")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^([0-9])/, "_$1"),
  };
}

// Back-compat alias for callers that still say "postgres".
export const parsePostgresUri = parseConnectionUri;
