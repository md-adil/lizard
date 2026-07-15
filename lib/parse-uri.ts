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
  // Remaining driver options (query params other than the ones we interpret as
  // `ssl`) as a URL query string with no leading "?", or null when there are
  // none. Preserved so e.g. Mongo's authSource/directConnection survive.
  options: string | null;
  name: string; // suggested identifier derived from the database name
}

// Query params we consume directly into structured fields, so they are not
// echoed back into the free-form `options` string.
const CONSUMED_PARAMS = new Set(["sslmode", "ssl"]);

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
  // Preserve every other query param (authSource, directConnection,
  // readPreference, replicaSet, …) so a re-built driver URI keeps them.
  const extra = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    if (!CONSUMED_PARAMS.has(k)) extra.append(k, v);
  }
  const options = extra.toString() || null;
  return {
    engine,
    host: u.hostname || "localhost",
    port: u.port ? Number(u.port) : DEFAULT_PORTS[engine],
    database,
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    ssl,
    options,
    name: (database || "db")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^([0-9])/, "_$1"),
  };
}

// Back-compat alias for callers that still say "postgres".
export const parsePostgresUri = parseConnectionUri;
