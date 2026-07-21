"use client";

// Column-aware ER diagram for a table's Graph tab. Each table renders as a
// real React component (not a chart symbol) so it can show a scrollable
// column list, an expand/collapse toggle, and edges anchored to the exact
// joined column — none of which ECharts' generic `graph` series can do.
// Layout comes from dagre (lib/relationship-layout.ts), a layered algorithm
// that reads better for FK relationships than force-directed jitter.
import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import type { ColumnInfo } from "@/lib/types";
import { relevantColumnNames, type GraphNode, type GraphEdge, type RelationshipGraph } from "@/lib/relationship-graph";
import { layoutGraph, NODE_WIDTH } from "@/lib/relationship-layout";

const HEADER_H = 40;
const ROW_H = 24;
const TOGGLE_ROW_H = 22;
const MAX_LIST_ROWS = 10;
const EXTERNAL_H = 52;
// A table can easily have more "relevant" (PK + edge-touching) columns than
// fit comfortably on a card (e.g. a wide join/custom-fields table with one
// column per relationship) — cap the default view too, not just "all
// columns", so a card never grows with the number of relationships either.
const DEFAULT_VISIBLE_CAP = 6;

// Default-visible columns are PK + whatever this node's edges actually
// touch, capped to a small number — independent of both the table's total
// column count AND its relationship count. Expanding swaps in the full
// column list (still capped/scrollable, see MAX_LIST_ROWS) rather than
// growing the card without bound. `relevantAll` (uncapped) is exposed
// separately so the node can still render an (invisible) anchor for every
// edge-touching column even when capped out of the visible list — an edge
// always needs a real handle to connect to.
function columnInfo(node: GraphNode, edges: GraphEdge[], expanded: boolean) {
  if (!node.columns) {
    return { visible: [] as ColumnInfo[], canToggle: false, hiddenCount: 0, relevantAll: [] as ColumnInfo[] };
  }
  const relevant = relevantColumnNames(node.id, edges, node.primaryKey ?? []);
  const relevantCols = node.columns.filter((c) => relevant.has(c.name));
  const visible = expanded ? node.columns : relevantCols.slice(0, DEFAULT_VISIBLE_CAP);
  const hiddenCount = node.columns.length - visible.length;
  return { visible, canToggle: hiddenCount > 0, hiddenCount, relevantAll: relevantCols };
}

// Which of this node's columns actually carry an outgoing/incoming edge —
// a column only gets a connector dot when it's genuinely connected to
// something, not on every visible row.
function anchorSets(nodeId: string, edges: GraphEdge[]): { outgoing: Set<string>; incoming: Set<string> } {
  const outgoing = new Set<string>();
  const incoming = new Set<string>();
  for (const e of edges) {
    if (e.source === nodeId && e.columns.from[0]) outgoing.add(e.columns.from[0]);
    if (e.target === nodeId && e.columns.to[0]) incoming.add(e.columns.to[0]);
  }
  return { outgoing, incoming };
}

function nodeHeight(node: GraphNode, edges: GraphEdge[], expanded: boolean): number {
  if (node.external) return EXTERNAL_H;
  const { visible, canToggle } = columnInfo(node, edges, expanded);
  return HEADER_H + Math.min(visible.length, MAX_LIST_ROWS) * ROW_H + (canToggle ? TOGGLE_ROW_H : 0);
}

type TableNodeData = {
  node: GraphNode;
  isFocus: boolean;
  visible: ColumnInfo[];
  relevantAll: ColumnInfo[];
  outgoing: Set<string>;
  incoming: Set<string>;
  canToggle: boolean;
  hiddenCount: number;
  expanded: boolean;
  highlighted: Set<string>;
  onToggleExpand: () => void;
  onNavigate: () => void;
  [key: string]: unknown;
};

function TableNode({ data }: NodeProps<Node<TableNodeData>>) {
  const {
    node,
    isFocus,
    visible,
    relevantAll,
    outgoing,
    incoming,
    canToggle,
    hiddenCount,
    expanded,
    highlighted,
    onToggleExpand,
    onNavigate,
  } = data;
  const visibleNames = new Set(visible.map((c) => c.name));
  // Every edge-touching column needs a real handle to connect to, even when
  // it's capped out of the visible rows — render those collapsed at the
  // header boundary instead of a specific row, rather than leaving edges
  // with nowhere valid to attach.
  const collapsedAnchors = relevantAll.filter((c) => !visibleNames.has(c.name));

  if (node.external) {
    return (
      <div
        className="rounded-lg border px-3 py-2.5 text-[12.5px]"
        style={{
          width: NODE_WIDTH,
          background: "var(--muted)",
          borderColor: "var(--border)",
          color: "var(--muted-foreground)",
          opacity: 0.7,
        }}
      >
        <div className="font-medium truncate">{node.table}</div>
        <div className="text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
          {node.schema} · external
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        width: NODE_WIDTH,
        background: "var(--card)",
        borderColor: isFocus ? "var(--primary)" : "var(--border)",
        borderWidth: isFocus ? 2 : 1,
      }}
    >
      <div
        className="px-3 py-2 text-[13px] font-semibold cursor-pointer hoverable truncate"
        style={{ borderBottom: "1px solid var(--border)" }}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate();
        }}
      >
        {node.table}
        {node.rowEstimate !== undefined && (
          <span className="ml-1.5 font-normal text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
            ≈{node.rowEstimate.toLocaleString()}
          </span>
        )}
      </div>
      {collapsedAnchors.map((col) => (
        <div key={col.name} style={{ position: "relative", height: 0 }}>
          {incoming.has(col.name) && (
            <Handle
              type="target"
              position={Position.Left}
              id={`in-${col.name}`}
              style={{ top: 0, opacity: 0, pointerEvents: "none" }}
            />
          )}
          {outgoing.has(col.name) && (
            <Handle
              type="source"
              position={Position.Right}
              id={`out-${col.name}`}
              style={{ top: 0, opacity: 0, pointerEvents: "none" }}
            />
          )}
        </div>
      ))}
      <div style={{ maxHeight: MAX_LIST_ROWS * ROW_H, overflowY: "auto" }}>
        {visible.map((col) => {
          const isPk = node.primaryKey?.includes(col.name);
          const domId = `col-${node.id}-${col.name}`;
          const isHighlighted = highlighted.has(domId);
          return (
            <div
              key={col.name}
              id={domId}
              className="relative flex items-center justify-between gap-2 px-3 text-[11.5px] code"
              style={{
                height: ROW_H,
                background: isHighlighted ? "var(--primary-soft)" : undefined,
                transition: "background-color 0.15s ease",
              }}
            >
              {incoming.has(col.name) && (
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`in-${col.name}`}
                  style={{ top: "50%", transform: "translateY(-50%)" }}
                />
              )}
              <span className="truncate">{col.name}</span>
              {isPk && (
                <span className="tag shrink-0" style={{ fontSize: 9 }}>
                  PK
                </span>
              )}
              {outgoing.has(col.name) && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`out-${col.name}`}
                  style={{ top: "50%", transform: "translateY(-50%)" }}
                />
              )}
            </div>
          );
        })}
      </div>
      {canToggle && (
        <button
          className="w-full text-left px-3 text-[11px] hoverable"
          style={{ height: TOGGLE_ROW_H, color: "var(--muted-foreground)", borderTop: "1px solid var(--border)" }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
        >
          {expanded ? "Show relevant only" : `+${hiddenCount} more columns`}
        </button>
      )}
    </div>
  );
}

// Self-referencing FKs (source === target node) degenerate to a zero-length
// line with the default edge path — bulge the curve out to the side instead.
function SelfLoopEdge({ sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps) {
  const dx = 50;
  const path = `M ${sourceX},${sourceY} C ${sourceX + dx},${sourceY - 30} ${targetX + dx},${targetY + 30} ${targetX},${targetY}`;
  return <BaseEdge path={path} style={style} markerEnd={markerEnd} />;
}

const NODE_TYPES = { table: TableNode };
const EDGE_TYPES = { selfLoop: SelfLoopEdge };

export function RelationshipDiagram({
  graph,
  focusId,
  height,
  onNodeClick,
}: {
  graph: RelationshipGraph;
  focusId: string;
  height: number;
  onNodeClick: (node: GraphNode) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Re-run whenever expand state changes — cheap position math, not a
  // physics simulation, so cards never overlap regardless of which are expanded.
  const positions = useMemo(() => {
    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
    return layoutGraph(graph, (id) => nodeHeight(nodesById.get(id)!, graph.edges, expandedIds.has(id)));
  }, [graph, expandedIds]);

  const rfNodes: Node<TableNodeData>[] = useMemo(
    () =>
      graph.nodes.map((node) => {
        const expanded = expandedIds.has(node.id);
        const { visible, canToggle, hiddenCount, relevantAll } = columnInfo(node, graph.edges, expanded);
        const { outgoing, incoming } = anchorSets(node.id, graph.edges);
        const pos = positions.get(node.id) ?? { x: 0, y: 0 };
        return {
          id: node.id,
          type: "table",
          position: pos,
          draggable: !node.external,
          data: {
            node,
            isFocus: node.id === focusId,
            visible,
            relevantAll,
            outgoing,
            incoming,
            canToggle,
            hiddenCount,
            expanded,
            highlighted,
            onToggleExpand: () => toggleExpand(node.id),
            onNavigate: () => {
              if (node.id !== focusId && !node.external) onNodeClick(node);
            },
          },
        };
      }),
    [graph, positions, expandedIds, highlighted, focusId, onNodeClick, toggleExpand],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const fromCol = e.columns.from[0];
        const toCol = e.columns.to[0];
        const dashed = e.kind === "virtual";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: fromCol ? `out-${fromCol}` : undefined,
          targetHandle: toCol ? `in-${toCol}` : undefined,
          type: e.selfRef ? "selfLoop" : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, color: dashed ? "var(--primary)" : "var(--muted-foreground)" },
          style: {
            stroke: dashed ? "var(--primary)" : "var(--muted-foreground)",
            strokeWidth: 1.5,
            strokeDasharray: dashed ? "6 4" : undefined,
          },
          data: {
            fromDomId: fromCol ? `col-${e.source}-${fromCol}` : undefined,
            toDomId: toCol ? `col-${e.target}-${toCol}` : undefined,
          },
        } satisfies Edge;
      }),
    [graph],
  );

  const onEdgeMouseEnter = useCallback((_: unknown, edge: Edge) => {
    const data = edge.data as { fromDomId?: string; toDomId?: string } | undefined;
    const ids = [data?.fromDomId, data?.toDomId].filter((x): x is string => !!x);
    setHighlighted(new Set(ids));
    for (const id of ids) document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }, []);
  const onEdgeMouseLeave = useCallback(() => setHighlighted(new Set()), []);

  return (
    <div style={{ height }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
