import { z } from "zod";
import { DB_ENGINES, DEFAULT_PORTS, type ConnectionConfig, type DbEngine } from "@/lib/types";

// Base object (used directly by PATCH via .partial() for partial updates).
export const connectionBaseSchema = z.object({
  // name doubles as the federation alias, so it must be a SQL identifier
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, "letters, digits, hyphens and underscores"),
  engine: z.enum(DB_ENGINES as [DbEngine, ...DbEngine[]]),
  host: z.string().min(1),
  // optional on input — defaulted from the engine on create (see connectionSchema)
  port: z.coerce.number().int().min(1).max(65535).optional(),
  database: z.string().min(1),
  readUser: z.string().min(1),
  // optional on input — defaulted on create (see connectionSchema) and left
  // unchanged on partial PATCH updates when omitted (e.g. toggling `disabled`
  // alone). A z.default() here would fill in "" for *any* PATCH that doesn't
  // resend it, silently wiping the stored password.
  readPassword: z.string().optional(),
  writeUser: z.string().nullish(),
  writePassword: z.string().nullish(),
  // optional on input, same reasoning as readPassword — defaulted on create,
  // preserved on partial update.
  ssl: z.boolean().optional(),
  allowedSchemas: z.array(z.string()).nullish(),
  // Free-form driver options (URL query string) — e.g. Mongo's authSource /
  // directConnection / readPreference. Preserved from a pasted URI.
  options: z.string().nullish(),
  // Admin-only toggle to take a connection offline without deleting it —
  // only ever set via PATCH (see connections/[id]/route.ts), never on create.
  disabled: z.boolean().optional(),
});

// Create schema: fills the engine's default port, and the readPassword/ssl
// defaults that connectionBaseSchema no longer supplies, when they weren't given.
export const connectionSchema = connectionBaseSchema.transform((c) => ({
  ...c,
  port: c.port ?? DEFAULT_PORTS[c.engine],
  readPassword: c.readPassword ?? "",
  ssl: c.ssl ?? false,
}));

export function redact(c: ConnectionConfig) {
  return { ...c, readPassword: undefined, writePassword: undefined, hasWrite: !!c.writeUser };
}
