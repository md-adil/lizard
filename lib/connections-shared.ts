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
  readPassword: z.string().default(""),
  writeUser: z.string().nullish(),
  writePassword: z.string().nullish(),
  ssl: z.boolean().default(false),
  allowedSchemas: z.array(z.string()).nullish(),
});

// Create schema: fills the engine's default port when one wasn't supplied.
export const connectionSchema = connectionBaseSchema.transform((c) => ({
  ...c,
  port: c.port ?? DEFAULT_PORTS[c.engine],
}));

export function redact(c: ConnectionConfig) {
  return { ...c, readPassword: undefined, writePassword: undefined, hasWrite: !!c.writeUser };
}
