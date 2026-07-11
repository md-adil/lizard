// MySQL introspection → Lizard's normalized ConnectionCatalog. A MySQL
// connection targets exactly one database (Phase 9 decision), so the catalog
// reports a single synthetic schema named after that database — keeping the
// connection → schema → table model uniform with Postgres.
//
// MySQL type names are normalized to Postgres-style udtNames (int4, int8,
// varchar, timestamp, bool, …) so the existing widget/display heuristics in
// lib/introspect/heuristics.ts work unchanged.
import type { ConnectionCatalog, ConnectionConfig, ColumnInfo, ForeignKeyInfo, TableInfo } from "@/lib/types";
import { getMysqlPool } from "./pool";

type Row = Record<string, unknown>;

export async function introspectMysql(conn: ConnectionConfig): Promise<ConnectionCatalog> {
  const pool = getMysqlPool(conn, "read");
  const db = conn.database;

  const [tablesRes] = await pool.query(
    `SELECT table_name AS name,
            CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind,
            COALESCE(table_rows, 0) AS row_estimate,
            NULLIF(table_comment, '') AS comment
     FROM information_schema.tables
     WHERE table_schema = ?
     ORDER BY table_name`,
    [db],
  );

  // information_schema column names come back UPPERCASE unless aliased, so every
  // selected column is aliased to the exact lowercase key the code reads below.
  const [columnsRes] = await pool.query(
    `SELECT table_name AS table_name, column_name AS column_name,
            ordinal_position AS ordinal_position, is_nullable AS is_nullable,
            column_default AS column_default, data_type AS data_type,
            column_type AS column_type, extra AS extra,
            NULLIF(column_comment, '') AS column_comment,
            character_maximum_length AS character_maximum_length,
            numeric_precision AS numeric_precision, numeric_scale AS numeric_scale
     FROM information_schema.columns
     WHERE table_schema = ?
     ORDER BY table_name, ordinal_position`,
    [db],
  );

  // PK / FK / UNIQUE via table_constraints ⋈ key_column_usage.
  const [consRes] = await pool.query(
    `SELECT tc.constraint_type AS constraint_type, tc.constraint_name AS constraint_name,
            kcu.table_name AS table_name, kcu.column_name AS column_name,
            kcu.ordinal_position AS ordinal_position,
            kcu.referenced_table_schema AS referenced_table_schema,
            kcu.referenced_table_name AS referenced_table_name,
            kcu.referenced_column_name AS referenced_column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
      AND tc.table_name = kcu.table_name
     WHERE tc.table_schema = ?
     ORDER BY kcu.table_name, tc.constraint_name, kcu.ordinal_position`,
    [db],
  );

  const tableMap = new Map<string, TableInfo>();
  for (const t of tablesRes as Row[]) {
    tableMap.set(t.name as string, {
      schema: db,
      name: t.name as string,
      kind: t.kind === "view" ? "view" : "table",
      comment: (t.comment as string) ?? null,
      rowEstimate: Number(t.row_estimate ?? 0),
      columns: [],
      primaryKey: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
  }

  for (const c of columnsRes as Row[]) {
    const table = tableMap.get(c.table_name as string);
    if (!table) continue;
    const columnType = (c.column_type as string) ?? "";
    const dataType = (c.data_type as string) ?? "";
    const extra = ((c.extra as string) ?? "").toLowerCase();
    const col: ColumnInfo = {
      name: c.column_name as string,
      dataType: columnType || dataType,
      udtName: normalizeUdt(dataType, columnType, c.column_name as string),
      nullable: c.is_nullable === "YES",
      default: (c.column_default as string) ?? null,
      isGenerated: extra.includes("generated") || extra.includes("auto_increment"),
      ordinal: Number(c.ordinal_position),
      comment: (c.column_comment as string) ?? null,
      enumValues: parseEnumValues(dataType, columnType),
      maxLength: c.character_maximum_length == null ? null : Number(c.character_maximum_length),
      numeric:
        c.numeric_precision == null
          ? null
          : {
              precision: Number(c.numeric_precision),
              scale: c.numeric_scale == null ? null : Number(c.numeric_scale),
              unsigned: /unsigned/i.test(columnType),
            },
    };
    table.columns.push(col);
  }

  // Group constraint columns by (table, constraint).
  interface Acc {
    type: string;
    table: string;
    cols: string[];
    refSchema: string | null;
    refTable: string | null;
    refCols: string[];
  }
  const consMap = new Map<string, Acc>();
  for (const r of consRes as Row[]) {
    const tableName = r.table_name as string;
    const name = r.constraint_name as string;
    const key = `${tableName}::${name}`;
    let acc = consMap.get(key);
    if (!acc) {
      acc = {
        type: r.constraint_type as string,
        table: tableName,
        cols: [],
        refSchema: (r.referenced_table_schema as string) ?? null,
        refTable: (r.referenced_table_name as string) ?? null,
        refCols: [],
      };
      consMap.set(key, acc);
    }
    acc.cols.push(r.column_name as string);
    if (r.referenced_column_name) acc.refCols.push(r.referenced_column_name as string);
  }

  for (const acc of consMap.values()) {
    const table = tableMap.get(acc.table);
    if (!table) continue;
    if (acc.type === "PRIMARY KEY") {
      table.primaryKey = acc.cols;
    } else if (acc.type === "UNIQUE") {
      table.uniqueConstraints.push(acc.cols);
    } else if (acc.type === "FOREIGN KEY" && acc.refTable) {
      const fk: ForeignKeyInfo = {
        constraintName: acc.table,
        columns: acc.cols,
        referencedSchema: acc.refSchema ?? db,
        referencedTable: acc.refTable,
        referencedColumns: acc.refCols,
      };
      table.foreignKeys.push(fk);
    }
  }

  const tables = [...tableMap.values()];
  return {
    connectionId: conn.id,
    connectionName: conn.name,
    engine: conn.engine,
    database: db,
    schemas: tables.length > 0 ? [{ name: db, tables }] : [],
    fetchedAt: new Date().toISOString(),
  };
}

// Map a MySQL data_type to a Postgres-style udtName so the shared heuristics
// (widgets, display-column guess, numeric detection) apply without a MySQL
// branch. column_type carries the detail needed for tinyint(1)→bool and enums.
function normalizeUdt(dataType: string, columnType: string, columnName: string): string {
  const t = dataType.toLowerCase();
  // tinyint(1) is always boolean-shaped. A wider/unspecified-width tinyint
  // named is_active, is_deleted, etc. is conventionally a boolean flag too,
  // even though MySQL itself just reports it as a plain small integer — but
  // only when BOTH the name and the type agree, so a genuine small-int
  // column that happens to start with "is_" isn't misread as a toggle.
  if (t === "tinyint" && (/^tinyint\(1\)/i.test(columnType) || /^is_/i.test(columnName))) {
    return "bool";
  }
  switch (t) {
    case "tinyint":
      return "int2";
    case "smallint":
      return "int2";
    case "mediumint":
    case "int":
    case "integer":
      return "int4";
    case "bigint":
      return "int8";
    case "decimal":
    case "numeric":
      return "numeric";
    case "float":
      return "float4";
    case "double":
    case "real":
      return "float8";
    case "datetime":
    case "timestamp":
      return "timestamp";
    case "date":
      return "date";
    case "char":
    case "varchar":
      return "varchar";
    case "tinytext":
    case "text":
    case "mediumtext":
    case "longtext":
      return "text";
    case "json":
      return "json";
    case "enum":
      return "enum";
    case "binary":
    case "varbinary":
    case "blob":
    case "tinyblob":
    case "mediumblob":
    case "longblob":
      return "bytea";
    default:
      return t; // time, year, set, geometry, … keep raw; widget falls back to text
  }
}

// `enum('a','b','c')` → ["a","b","c"] so the select-widget heuristic lights up.
function parseEnumValues(dataType: string, columnType: string): string[] | null {
  if (dataType.toLowerCase() !== "enum") return null;
  const inner = columnType.match(/^enum\((.*)\)$/i);
  if (!inner) return null;
  const values = [...inner[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
  return values.length > 0 ? values : null;
}
