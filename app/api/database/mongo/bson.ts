// BSON ⇄ JSON bridging. MongoDB documents carry BSON types (ObjectId, Date,
// Decimal128, Long, Binary, …) that the rest of Lizard — the grid, the JSON
// view, the record editor — expects as plain JSON scalars, exactly the shape
// the pg/mysql drivers already hand back (timestamps as ISO strings, ids as
// strings). `serializeDoc` flattens a document on read; `coerceWriteValue`
// turns an edited JSON value back into the BSON type its column expects on
// write, keyed off the sampled udtName.
import { ObjectId, Decimal128, Long, Binary, type Document } from "mongodb";

// A 24-char hex string is the wire form of an ObjectId.
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

// Deep-convert a value read from MongoDB into JSON-friendly output. Scalars the
// UI understands (string/number/boolean/null) pass through; BSON wrappers
// collapse to their string/number form; nested objects/arrays recurse so a
// document column (udtName "jsonb") renders in the JSON view unchanged.
export function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof ObjectId) return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Decimal128) return v.toString();
  if (v instanceof Long) return v.toString();
  if (v instanceof Binary) return v.toString("base64");
  if (Array.isArray(v)) return v.map(serializeValue);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = serializeValue(val);
    }
    return out;
  }
  return v;
}

export function serializeDoc(doc: Document): Record<string, unknown> {
  return serializeValue(doc) as Record<string, unknown>;
}

// Parse an `_id` filter value into the type the collection actually stores.
// Most collections key on ObjectId, but string/number `_id`s are legal too, so
// a value that isn't a 24-char hex string is used as-is.
export function coerceId(value: unknown): unknown {
  if (value instanceof ObjectId) return value;
  if (typeof value === "string" && OBJECT_ID_RE.test(value)) return new ObjectId(value);
  return value;
}

// Turn an edited JSON value into the BSON type its column expects on write,
// using the udtName the sampler recorded. Unknown/absent columns pass through
// so free-form document fields aren't lost. An empty string clears the field
// to null (matching the relational CRUD path's coerceValue).
export function coerceWriteValue(value: unknown, udtName: string | undefined): unknown {
  if (value === "" || value === undefined) return null;
  if (value === null) return null;
  switch (udtName) {
    case "objectid":
      return coerceId(value);
    case "timestamp":
    case "date":
      return typeof value === "string" || typeof value === "number" ? new Date(value) : value;
    case "int4":
    case "int8":
      return typeof value === "string" && value.trim() !== "" ? Math.trunc(Number(value)) : value;
    case "float8":
    case "numeric":
      return typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    case "bool":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    default:
      return value;
  }
}
