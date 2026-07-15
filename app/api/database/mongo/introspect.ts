// MongoDB introspection → Lizard's normalized ConnectionCatalog. Mongo has no
// declared schema: each collection's shape is *inferred* by sampling documents
// (§5.6 / Phase 9D "sampling-based introspection"). A Mongo connection targets
// one database, reported as a single synthetic schema named after that database
// — matching the MySQL convention (app/api/database/mysql/introspect.ts) so the
// connection → schema → table model and every downstream heuristic stay uniform.
//
// Inferred BSON types are mapped to the Postgres-style udtNames the shared
// widget/display heuristics (lib/introspect/heuristics.ts) already understand.
import type { ConnectionCatalog, ConnectionConfig, ColumnInfo, TableInfo } from "@/lib/types";
import { ObjectId, Decimal128, Long, type Document } from "mongodb";
import { getMongoDb, READ_MAX_TIME_MS } from "./client";

// How many documents to sample per collection when inferring its shape. Enough
// to catch optional fields without scanning a large collection.
const SAMPLE_SIZE = 100;

export async function introspectMongo(conn: ConnectionConfig): Promise<ConnectionCatalog> {
  const db = await getMongoDb(conn, "read");
  const dbName = conn.database;

  const collections = await db.listCollections({}, { nameOnly: false }).toArray();
  const tables: TableInfo[] = [];

  for (const coll of collections) {
    const name = coll.name as string;
    // Skip system collections (indexes, views metadata, …).
    if (name.startsWith("system.")) continue;
    const kind: "table" | "view" = coll.type === "view" ? "view" : "table";
    tables.push(await introspectCollection(db, dbName, name, kind));
  }

  tables.sort((a, b) => a.name.localeCompare(b.name));

  return {
    connectionId: conn.id,
    connectionName: conn.name,
    engine: conn.engine,
    database: dbName,
    schemas: tables.length > 0 ? [{ name: dbName, tables }] : [],
    fetchedAt: new Date().toISOString(),
  };
}

async function introspectCollection(
  db: Awaited<ReturnType<typeof getMongoDb>>,
  schema: string,
  name: string,
  kind: "table" | "view",
): Promise<TableInfo> {
  const coll = db.collection(name);

  // Sample documents. `$sample` needs a real collection; views don't support
  // it, so fall back to a plain limited find there.
  let docs: Document[] = [];
  try {
    docs =
      kind === "view"
        ? await coll.find({}, { limit: SAMPLE_SIZE, maxTimeMS: READ_MAX_TIME_MS }).toArray()
        : await coll
            .aggregate([{ $sample: { size: SAMPLE_SIZE } }], { maxTimeMS: READ_MAX_TIME_MS })
            .toArray();
  } catch {
    docs = await coll.find({}, { limit: SAMPLE_SIZE, maxTimeMS: READ_MAX_TIME_MS }).toArray();
  }

  const columns = inferColumns(docs);

  // Row estimate — cheap metadata count, not an exact scan.
  let rowEstimate = 0;
  try {
    rowEstimate = kind === "view" ? 0 : await coll.estimatedDocumentCount({ maxTimeMS: READ_MAX_TIME_MS });
  } catch {
    /* estimate is best-effort */
  }

  // Indexed fields (top-level keys of every index) drive global search's
  // cheap-to-search set, exactly like the relational indexedColumns.
  const indexedColumns: string[] = [];
  try {
    const indexes = await coll.indexes();
    const seen = new Set<string>();
    for (const idx of indexes) {
      for (const key of Object.keys(idx.key ?? {})) {
        const top = key.split(".")[0];
        if (!seen.has(top)) {
          seen.add(top);
          indexedColumns.push(top);
        }
      }
    }
  } catch {
    /* _id is always indexed even if listing fails */
    indexedColumns.push("_id");
  }

  return {
    schema,
    name,
    kind,
    comment: null,
    rowEstimate,
    columns,
    primaryKey: ["_id"], // every MongoDB document is keyed by _id
    foreignKeys: [], // no declared relationships in a document store
    uniqueConstraints: [],
    checkConstraints: [],
    indexedColumns,
  };
}

interface FieldAcc {
  udtCounts: Map<string, number>;
  seen: number; // docs in which this field was present and non-null
  firstOrdinal: number;
}

// Build the column list from sampled documents. Fields are unioned across the
// sample; a field's type is the most frequently-seen inferred udtName, and a
// field missing from (or null in) any sampled doc is marked nullable. Only
// top-level fields become columns — nested objects/arrays are one column each,
// rendered in the JSON view.
function inferColumns(docs: Document[]): ColumnInfo[] {
  const fields = new Map<string, FieldAcc>();
  let ordinalCounter = 0;

  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      let acc = fields.get(key);
      if (!acc) {
        acc = { udtCounts: new Map(), seen: 0, firstOrdinal: ordinalCounter++ };
        fields.set(key, acc);
      }
      if (value === null || value === undefined) continue;
      acc.seen++;
      const udt = inferUdt(value);
      acc.udtCounts.set(udt, (acc.udtCounts.get(udt) ?? 0) + 1);
    }
  }

  const total = docs.length;
  const columns: ColumnInfo[] = [];
  for (const [name, acc] of fields) {
    // Pick the dominant inferred type; ties fall back to "text".
    let udtName = "text";
    let best = 0;
    for (const [udt, count] of acc.udtCounts) {
      if (count > best) {
        best = count;
        udtName = udt;
      }
    }
    // A field with only null/missing values across the sample.
    if (acc.udtCounts.size === 0) udtName = "text";

    columns.push({
      name,
      dataType: udtName,
      udtName,
      // _id is always present and required; other fields are nullable if the
      // sample ever lacked them.
      nullable: name === "_id" ? false : acc.seen < total,
      default: null,
      // _id is auto-assigned by the server when omitted — treat like a
      // generated column so the create form doesn't require it.
      isGenerated: false,
      ordinal: acc.firstOrdinal,
      comment: null,
      enumValues: null,
      maxLength: null,
      numeric: null,
    });
  }

  // Ensure _id sorts first; keep sampled order otherwise.
  columns.sort((a, b) => {
    if (a.name === "_id") return -1;
    if (b.name === "_id") return 1;
    return a.ordinal - b.ordinal;
  });
  columns.forEach((c, i) => (c.ordinal = i + 1));

  // A collection with zero sampled docs still needs an editable _id column.
  if (!columns.some((c) => c.name === "_id")) {
    columns.unshift({
      name: "_id",
      dataType: "objectid",
      udtName: "objectid",
      nullable: false,
      default: null,
      isGenerated: false,
      ordinal: 0,
      comment: null,
      enumValues: null,
      maxLength: null,
      numeric: null,
    });
    columns.forEach((c, i) => (c.ordinal = i + 1));
  }

  return columns;
}

// Map a sampled BSON value to a Postgres-style udtName so the shared widget and
// display-column heuristics apply without a Mongo branch.
function inferUdt(value: unknown): string {
  if (value instanceof ObjectId) return "objectid";
  if (value instanceof Date) return "timestamp";
  if (value instanceof Decimal128) return "numeric";
  if (value instanceof Long) return "int8";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int8" : "float8";
  if (typeof value === "string") return "text";
  // Arrays and embedded documents both render as JSON.
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) return "jsonb";
  return "text";
}
