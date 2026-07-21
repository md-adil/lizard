// Pure wrapper around @dagrejs/dagre — a layered (not force-directed) layout
// reads better than physics-jitter for FK relationships, and unlike a force
// simulation this is just position math, so it's cheap to re-run whenever a
// card's height changes (e.g. expand/collapse toggling its column list).
import dagre from "@dagrejs/dagre";
import type { RelationshipGraph } from "@/lib/relationship-graph";

export const NODE_WIDTH = 260;

export function layoutGraph(
  graph: RelationshipGraph,
  nodeHeight: (nodeId: string) => number,
  direction: "LR" | "TB" = "LR",
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: nodeHeight(node.id) });
  }
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue; // self-loops don't participate in ranking
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes) {
    const { x, y } = g.node(node.id);
    // dagre positions are the node's center; React Flow positions are top-left.
    positions.set(node.id, { x: x - NODE_WIDTH / 2, y: y - nodeHeight(node.id) / 2 });
  }
  return positions;
}
