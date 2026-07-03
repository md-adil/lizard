import { z } from "zod";
import type { ConnectionConfig } from "@/lib/types";

export const connectionSchema = z.object({
  // name doubles as the federation alias, so it must be a SQL identifier
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase letters, digits and underscores; must start with a letter"),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1),
  readUser: z.string().min(1),
  readPassword: z.string().default(""),
  writeUser: z.string().nullish(),
  writePassword: z.string().nullish(),
  ssl: z.boolean().default(false),
  allowedSchemas: z.array(z.string()).nullish(),
});

export function redact(c: ConnectionConfig) {
  return { ...c, readPassword: undefined, writePassword: undefined, hasWrite: !!c.writeUser };
}
