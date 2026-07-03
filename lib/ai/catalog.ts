// Compact, token-budgeted serialization of the multi-connection catalog for
// the model. One line per table keeps the schema scannable and cheap:
//   users_service.public.users (~12000 rows): id uuid [pk] [not null], ...
import type { Catalog, ConnectionCatalog, TableInfo, ColumnInfo, VirtualFk } from "@/lib/types";

// ~4 chars/token heuristic; default budget keeps the schema well under the
// context ceiling while leaving room for prompt rules + history.
const DEFAULT_BUDGET_CHARS = 120_000;

export interface SerializeOptions {
  // if set, only these connections (by name) are included
  connections?: string[];
  budgetChars?: number;
}

function columnLine(col: ColumnInfo, table: TableInfo): string {
  const parts: string[] = [`${col.name} ${col.udtName}`];
  if (table.primaryKey.includes(col.name)) parts.push("[pk]");
  const fk = table.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === col.name);
  if (fk) parts.push(`[fk→${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumns[0]}]`);
  if (col.enumValues && col.enumValues.length > 0) parts.push(`[enum: ${col.enumValues.join("|")}]`);
  if (!col.nullable) parts.push("[not null]");
  let line = parts.join(" ");
  if (col.comment) line += ` — ${col.comment.replace(/\s+/g, " ").trim()}`;
  return line;
}

function tableBlock(t: TableInfo): string {
  const header = `${t.schema}.${t.name}${t.kind === "view" ? " (view)" : ""} (~${t.rowEstimate} rows)${
    t.comment ? ` — ${t.comment.replace(/\s+/g, " ").trim()}` : ""
  }:`;
  const cols = t.columns.map((c) => `  ${columnLine(c, t)}`);
  // composite FKs (not representable on a single column line)
  const compositeFks = t.foreignKeys
    .filter((f) => f.columns.length > 1)
    .map((f) => `  FK (${f.columns.join(", ")}) → ${f.referencedSchema}.${f.referencedTable} (${f.referencedColumns.join(", ")})`);
  return [header, ...cols, ...compositeFks].join("\n");
}

function connectionBlock(conn: ConnectionCatalog): string {
  const lines: string[] = [`connection ${conn.connectionName} (postgres database "${conn.database}")`];
  if (conn.error) {
    lines.push(`  (introspection failed: ${conn.error})`);
    return lines.join("\n");
  }
  for (const schema of conn.schemas) {
    for (const table of schema.tables) {
      lines.push(tableBlock(table));
    }
  }
  return lines.join("\n");
}

function virtualFkLine(fk: VirtualFk): string {
  return `VIRTUAL FK: ${fk.fromConnection}.${fk.fromSchema}.${fk.fromTable}.${fk.fromColumn} → ${fk.toConnection}.${fk.toSchema}.${fk.toTable}.${fk.toColumn}${fk.label ? ` (${fk.label})` : ""}`;
}

// Serialize the catalog into a compact text schema. If the result exceeds the
// budget, the largest tables' column lists are elided first (headers stay so
// the model still knows the tables exist).
export function serializeCatalog(catalog: Catalog, options: SerializeOptions = {}): string {
  const budget = options.budgetChars ?? DEFAULT_BUDGET_CHARS;
  const scope = options.connections?.length
    ? catalog.connections.filter((c) => options.connections!.includes(c.connectionName))
    : catalog.connections;

  const scopedNames = new Set(scope.map((c) => c.connectionName));
  const fks = catalog.virtualFks.filter(
    (fk) => scopedNames.has(fk.fromConnection) && scopedNames.has(fk.toConnection)
  );

  let body = scope.map(connectionBlock).join("\n\n");

  if (body.length > budget) {
    // over budget: drop column details for the widest tables until we fit,
    // keeping table headers so the model can still name every table.
    const tables: { conn: ConnectionCatalog; table: TableInfo }[] = [];
    for (const conn of scope) {
      for (const schema of conn.schemas) {
        for (const table of schema.tables) tables.push({ conn, table });
      }
    }
    tables.sort((a, b) => b.table.columns.length - a.table.columns.length);
    const elided = new Set<TableInfo>();
    for (const { table } of tables) {
      if (body.length <= budget) break;
      elided.add(table);
      body = scope
        .map((conn) => {
          const lines: string[] = [`connection ${conn.connectionName} (postgres database "${conn.database}")`];
          if (conn.error) {
            lines.push(`  (introspection failed: ${conn.error})`);
            return lines.join("\n");
          }
          for (const schema of conn.schemas) {
            for (const t of schema.tables) {
              if (elided.has(t)) {
                lines.push(
                  `${t.schema}.${t.name} (~${t.rowEstimate} rows): columns elided — ${t.columns
                    .map((c) => c.name)
                    .join(", ")}`
                );
              } else {
                lines.push(tableBlock(t));
              }
            }
          }
          return lines.join("\n");
        })
        .join("\n\n");
    }
  }

  const fkSection = fks.length
    ? `\n\nDeclared cross-service links (use these to join across connections):\n${fks.map(virtualFkLine).join("\n")}`
    : "";

  return `${body}${fkSection}`;
}
