// Introspection service: builds a normalized catalog across all registered
// connections and schemas from pg_catalog/information_schema. Cached per
// connection with a TTL; refresh on demand.
import type {
  Catalog,
  ConnectionCatalog,
  ConnectionConfig,
  SchemaCatalog,
  TableInfo,
  ColumnInfo,
  ForeignKeyInfo,
  CheckConstraintInfo,
} from "@/lib/types";
import { getPool } from "@/lib/db/pools";
import { listConnections, listVirtualFks } from "@/lib/metadata/store";

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast"];
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { catalog: ConnectionCatalog; at: number }>();

export async function getCatalog(refresh = false): Promise<Catalog> {
  const conns = listConnections();
  const results = await Promise.all(conns.map((c) => getConnectionCatalog(c, refresh)));
  return { connections: results, virtualFks: listVirtualFks() };
}

export async function getConnectionCatalog(conn: ConnectionConfig, refresh = false): Promise<ConnectionCatalog> {
  const cached = cache.get(conn.id);
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.catalog;
  try {
    const catalog = await introspect(conn);
    cache.set(conn.id, { catalog, at: Date.now() });
    return catalog;
  } catch (e) {
    const errCatalog: ConnectionCatalog = {
      connectionId: conn.id,
      connectionName: conn.name,
      database: conn.database,
      schemas: [],
      fetchedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
    return errCatalog;
  }
}

export function invalidateCatalog(connectionId?: string): void {
  if (connectionId) cache.delete(connectionId);
  else cache.clear();
}

async function introspect(conn: ConnectionConfig): Promise<ConnectionCatalog> {
  const pool = getPool(conn, "read");

  const schemasRes = await pool.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace
     WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
     ORDER BY nspname`,
  );
  let schemaNames = schemasRes.rows.map((r) => r.nspname).filter((n) => !SYSTEM_SCHEMAS.includes(n));
  if (conn.allowedSchemas && conn.allowedSchemas.length > 0) {
    schemaNames = schemaNames.filter((n) => conn.allowedSchemas!.includes(n));
  }
  if (schemaNames.length === 0) {
    return {
      connectionId: conn.id,
      connectionName: conn.name,
      database: conn.database,
      schemas: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  // tables + views with row estimates and comments
  const tablesRes = await pool.query(
    `SELECT n.nspname AS schema, c.relname AS name,
            CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END AS kind,
            GREATEST(c.reltuples, 0)::bigint AS row_estimate,
            obj_description(c.oid, 'pg_class') AS comment
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm') AND n.nspname = ANY($1)
     ORDER BY n.nspname, c.relname`,
    [schemaNames],
  );

  // columns (with enum values, comments, generated flag)
  const columnsRes = await pool.query(
    `SELECT c.table_schema, c.table_name, c.column_name, c.ordinal_position,
            c.is_nullable, c.column_default, c.data_type, c.udt_name,
            c.character_maximum_length,
            (c.is_generated = 'ALWAYS' OR c.identity_generation IS NOT NULL) AS is_generated,
            col_description(pc.oid, c.ordinal_position) AS comment,
            CASE WHEN t.typtype = 'e' THEN
              (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid)::text[]
            END AS enum_values
     FROM information_schema.columns c
     JOIN pg_class pc ON pc.relname = c.table_name
     JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
     LEFT JOIN pg_type t ON t.typname = c.udt_name
       AND t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.udt_schema)
     WHERE c.table_schema = ANY($1)
     ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    [schemaNames],
  );

  // constraints: pk, fk, unique
  const consRes = await pool.query(
    `SELECT n.nspname AS schema, rel.relname AS table, con.conname, con.contype,
            (SELECT array_agg(a.attname::text ORDER BY u.ord)
             FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum)::text[] AS columns,
            fn.nspname AS ref_schema, frel.relname AS ref_table,
            (SELECT array_agg(a.attname::text ORDER BY u.ord)
             FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = u.attnum)::text[] AS ref_columns,
            pg_get_constraintdef(con.oid) AS definition
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     LEFT JOIN pg_class frel ON frel.oid = con.confrelid
     LEFT JOIN pg_namespace fn ON fn.oid = frel.relnamespace
     WHERE n.nspname = ANY($1) AND con.contype IN ('p', 'f', 'u', 'c')`,
    [schemaNames],
  );

  // assemble
  const tableMap = new Map<string, TableInfo>();
  for (const t of tablesRes.rows) {
    tableMap.set(`${t.schema}.${t.name}`, {
      schema: t.schema,
      name: t.name,
      kind: t.kind,
      comment: t.comment,
      rowEstimate: Number(t.row_estimate),
      columns: [],
      primaryKey: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
  }

  for (const c of columnsRes.rows) {
    const table = tableMap.get(`${c.table_schema}.${c.table_name}`);
    if (!table) continue;
    const col: ColumnInfo = {
      name: c.column_name,
      dataType: c.data_type,
      udtName: c.udt_name,
      nullable: c.is_nullable === "YES",
      default: c.column_default,
      isGenerated: !!c.is_generated,
      ordinal: c.ordinal_position,
      comment: c.comment,
      enumValues: c.enum_values ?? null,
      maxLength: c.character_maximum_length,
    };
    table.columns.push(col);
  }

  for (const con of consRes.rows) {
    const table = tableMap.get(`${con.schema}.${con.table}`);
    if (!table || !con.columns) continue;
    if (con.contype === "p") {
      table.primaryKey = con.columns;
    } else if (con.contype === "f") {
      const fk: ForeignKeyInfo = {
        constraintName: con.conname,
        columns: con.columns,
        referencedSchema: con.ref_schema,
        referencedTable: con.ref_table,
        referencedColumns: con.ref_columns,
      };
      table.foreignKeys.push(fk);
    } else if (con.contype === "u") {
      table.uniqueConstraints.push(con.columns);
    } else if (con.contype === "c") {
      table.checkConstraints.push(parseCheck(con.conname, con.definition, con.columns));
    }
  }

  const bySchema = new Map<string, SchemaCatalog>();
  for (const name of schemaNames) bySchema.set(name, { name, tables: [] });
  for (const t of tableMap.values()) bySchema.get(t.schema)?.tables.push(t);

  return {
    connectionId: conn.id,
    connectionName: conn.name,
    database: conn.database,
    schemas: [...bySchema.values()].filter((s) => s.tables.length > 0),
    fetchedAt: new Date().toISOString(),
  };
}

// Recognize `CHECK (col IN ('a','b'))` (compiled by PG to `col = ANY (ARRAY[...])`)
// so the UI can render a select widget.
function parseCheck(name: string, definition: string, columns: string[]): CheckConstraintInfo {
  const result: CheckConstraintInfo = { name, expression: definition, inColumn: null, inValues: null };
  const m = definition.match(/\(?\(?(\w+)\)?(?:::\w+(?:\s+\w+)*)?\s*=\s*ANY\s*\(\s*(?:\()?ARRAY\[(.+?)\]/i);
  if (m && columns.length === 1) {
    const values = [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1].replace(/''/g, "'"));
    if (values.length > 0) {
      result.inColumn = columns[0];
      result.inValues = values;
    }
  }
  return result;
}
