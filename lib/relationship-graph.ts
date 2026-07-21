// Pure helpers turning a schema's catalog data (tables + native FKs + virtual
// FKs) into a graph shape a renderer can consume — used by both the
// schema-wide relationship graph page and the per-table Info sheet's mini
// neighborhood view, so both always agree on what's connected to what.
import type { ColumnInfo, SchemaDetail } from "@/lib/types";
import { vfkMatchesSource, resolveToSchema } from "@/lib/introspect/virtual-fk";

export interface GraphNode {
  id: string;
  table: string;
  schema: string;
  // true for a virtual/native FK target outside this schema/connection —
  // rendered but not navigable, and never fetched (would mean an unbounded
  // fan-out of extra requests just to draw one edge). External nodes have no
  // columns/primaryKey — their schema is never fetched.
  external: boolean;
  rowEstimate?: number;
  kind?: "table" | "view";
  columns?: ColumnInfo[];
  primaryKey?: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "real" | "virtual";
  selfRef: boolean;
  label?: string | null;
  columns: { from: string[]; to: string[] };
}

export interface RelationshipGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function nodeId(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function externalNodeId(connection: string, schema: string, table: string): string {
  return `external:${connection}/${schema}/${table}`;
}

// Builds every table in `detail` as a node, and every real + virtual FK
// touching those tables as an edge. FK targets outside this schema/connection
// become "external" nodes rather than triggering extra fetches to resolve
// their real row count/kind.
export function buildSchemaGraph(connectionId: string, schema: string, detail: SchemaDetail): RelationshipGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const table of detail.tables) {
    nodes.set(nodeId(schema, table.name), {
      id: nodeId(schema, table.name),
      table: table.name,
      schema,
      external: false,
      rowEstimate: table.rowEstimate,
      kind: table.kind,
      columns: table.columns,
      primaryKey: table.primaryKey,
    });
  }

  for (const table of detail.tables) {
    const sourceId = nodeId(schema, table.name);

    for (const fk of table.foreignKeys) {
      const external = fk.referencedSchema !== schema;
      const targetId = external
        ? externalNodeId(connectionId, fk.referencedSchema, fk.referencedTable)
        : nodeId(schema, fk.referencedTable);
      if (external && !nodes.has(targetId)) {
        nodes.set(targetId, { id: targetId, table: fk.referencedTable, schema: fk.referencedSchema, external: true });
      }
      const id = `real:${table.name}:${fk.constraintName}`;
      edges.set(id, {
        id,
        source: sourceId,
        target: targetId,
        kind: "real",
        selfRef: sourceId === targetId,
        columns: { from: fk.columns, to: fk.referencedColumns },
      });
    }

    // detail.virtualFks is every vfk touching this connection (not
    // pre-scoped to this schema — fromSchema/fromTable may be glob
    // patterns), so vfkMatchesSource decides which ones actually originate
    // from this table.
    for (const v of detail.virtualFks) {
      if (!vfkMatchesSource(v, connectionId, schema, table.name)) continue;
      const toSchema = resolveToSchema(v, schema);
      const external = v.toConnection !== connectionId || toSchema !== schema;
      const targetId = external ? externalNodeId(v.toConnection, toSchema, v.toTable) : nodeId(schema, v.toTable);
      if (external && !nodes.has(targetId)) {
        nodes.set(targetId, { id: targetId, table: v.toTable, schema: toSchema, external: true });
      }
      edges.set(v.id, {
        id: v.id,
        source: sourceId,
        target: targetId,
        kind: "virtual",
        selfRef: sourceId === targetId,
        label: v.label,
        columns: { from: v.pairs.map((p) => p.from), to: v.pairs.map((p) => p.to) },
      });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

// The focus table plus every table with a direct real-or-virtual FK edge
// to/from it — same edge set as buildSchemaGraph, just filtered, so the
// mini view and full graph never disagree about what's connected.
export function buildNeighborGraph(
  connectionId: string,
  schema: string,
  detail: SchemaDetail,
  tableName: string,
): RelationshipGraph {
  const full = buildSchemaGraph(connectionId, schema, detail);
  const focusId = nodeId(schema, tableName);
  const edges = full.edges.filter((e) => e.source === focusId || e.target === focusId);
  const nodeIds = new Set<string>([focusId]);
  for (const e of edges) {
    nodeIds.add(e.source);
    nodeIds.add(e.target);
  }
  return { nodes: full.nodes.filter((n) => nodeIds.has(n.id)), edges };
}

// PK columns + every column this node's edges actually touch — the default
// visible set in the ER diagram, independent of the table's total column
// count (a 200-column table with 2 FK relationships in view still renders
// as a compact card).
export function relevantColumnNames(nodeId: string, edges: GraphEdge[], primaryKey: string[]): Set<string> {
  const set = new Set(primaryKey);
  for (const e of edges) {
    if (e.source === nodeId) e.columns.from.forEach((c) => set.add(c));
    if (e.target === nodeId) e.columns.to.forEach((c) => set.add(c));
  }
  return set;
}
