// Parse a Postgres connection string into Lizard connection fields, using the
// WHATWG URL parser. Handles postgres:// and postgresql://, url-encoded
// credentials, an optional port, and sslmode.
export interface ParsedUri {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  name: string; // suggested identifier derived from the database name
}

export function parsePostgresUri(raw: string): ParsedUri | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return null;
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const sslmode = u.searchParams.get("sslmode");
  return {
    host: u.hostname || "localhost",
    port: u.port ? Number(u.port) : 5432,
    database,
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    ssl: sslmode === "require" || sslmode === "verify-full" || sslmode === "verify-ca",
    name: (database || "db")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^([0-9])/, "_$1"),
  };
}
