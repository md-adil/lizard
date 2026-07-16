"use client";

// Kanban board: dropping a card issues an UPDATE of the group column, backed
// by the grouped fetch (use-grouped-rows.ts) rather than the table's flat page.
import { useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { TableMeta } from "./useTableMeta";
import { dataApiUrl } from "./data-api";
import { Card } from "@/components/ui/card";
import type { FkLabels } from "@/lib/types";
import { fkLabelFor } from "@/lib/data/fk-labels";
import { effectiveKey } from "@/lib/introspect/heuristics";
import { type Row, rowPk, displayValue, CardFields } from "./table-views";

function KanbanColumn({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`w-64 shrink-0 rounded-lg p-2 ring-2 transition-shadow ${isOver ? "ring-[var(--primary)]" : "ring-transparent"}`}
      style={{ background: "var(--muted)" }}
    >
      {children}
    </div>
  );
}

function KanbanCard({
  id,
  disabled,
  onOpen,
  children,
}: {
  id: string;
  disabled: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  // The overlay (rendered by DragOverlay below) is what visibly follows the
  // pointer — this source element just dims in place, so it doesn't also
  // translate and double up with the overlay copy.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <Card
      ref={setNodeRef}
      size="sm"
      onClick={onOpen}
      className="p-3 cursor-pointer transition-opacity hover:ring-2 hover:ring-[var(--primary)]"
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: "none" }}
      {...attributes}
      {...listeners}
    >
      {children}
    </Card>
  );
}

export function KanbanView({
  meta,
  rows,
  fkLabels,
  groupBy,
  groupCounts,
  onOpen,
  onChanged,
}: {
  meta: TableMeta;
  rows: Row[];
  fkLabels: FkLabels;
  groupBy: string;
  // exact per-group row count from the server (see listGroupedRows) — lets a
  // column that was capped at the per-group fetch limit say "+N more" instead
  // of silently looking complete.
  groupCounts?: Record<string, number>;
  onOpen: (row: Row) => void;
  onChanged: () => void;
}) {
  const cm = meta.columns.find((c) => c.col.name === groupBy);
  const isBool = cm?.col.udtName === "bool";
  const nullable = cm?.col.nullable ?? true;
  const canWrite = !meta.isView && effectiveKey(meta.table).length > 0;

  // column order: explicit options (enum / check-IN), else booleans, else the
  // distinct values present in the loaded rows.
  const NULL_KEY = "∅";
  let keys: string[];
  if (cm?.options) keys = [...cm.options];
  else if (isBool) keys = ["true", "false"];
  else {
    keys = [
      ...new Set(
        rows
          .map((r) => r[groupBy])
          .filter((v) => v != null)
          .map((v) => String(v)),
      ),
    ];
  }
  if (nullable) keys.push(NULL_KEY);

  const labelFor = (key: string) => {
    if (key === NULL_KEY) return "∅ none";
    if (cm?.optionLabels?.[key]) return cm.optionLabels[key];
    if (!cm?.ref) return key;
    // A reference label can depend on more than the grouped value (polymorphic
    // relations key on a discriminator too), so resolve it against a row that
    // actually belongs to this group.
    const sample = rows.find((r) => String(r[groupBy]) === key);
    return (sample && fkLabelFor(fkLabels, groupBy, sample)) ?? key;
  };
  // Normalize bool values: MySQL returns 1/0, Postgres returns true/false.
  const normalizeBool = (v: unknown): string => {
    if (v === true || v === 1 || v === "1" || v === "true") return "true";
    if (v === false || v === 0 || v === "0" || v === "false") return "false";
    return String(v);
  };
  const groupOf = (row: Row) => {
    const v = row[groupBy];
    if (v == null) return NULL_KEY;
    if (isBool) return normalizeBool(v);
    return String(v);
  };

  // `groupCounts` keys come straight from the DB (raw column value, "" for
  // null) — normalize the same way `groupOf` normalizes rows so they can be
  // looked up by display key.
  const totalFor = (key: string): number | undefined => {
    if (!groupCounts) return undefined;
    if (key === NULL_KEY) return groupCounts[""];
    if (isBool) {
      const entry = Object.entries(groupCounts).find(([k]) => normalizeBool(k) === key);
      return entry?.[1];
    }
    return groupCounts[key];
  };

  async function move(row: Row, toKey: string) {
    if (!canWrite) return;
    const value = toKey === NULL_KEY ? null : toKey;
    if (groupOf(row) === toKey) return;
    await fetch(dataApiUrl({ connection: meta.connection, table: meta.table.name, path: "row", schema: meta.schema }), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pk: rowPk(meta, row), data: { [groupBy]: value } }),
    });
    onChanged();
  }

  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(e: DragEndEvent) {
    setActiveIdx(null);
    const idx = Number(e.active.id);
    const row = rows[idx];
    if (row && e.over) move(row, String(e.over.id));
  }

  const activeRow = activeIdx != null ? rows[activeIdx] : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveIdx(Number(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveIdx(null)}
    >
      <div className="flex gap-3 overflow-x-auto scrollbar-thin pb-2">
        {keys.map((key) => {
          const cards = rows.filter((r) => groupOf(r) === key);
          const total = totalFor(key);
          return (
            <KanbanColumn key={key} id={key}>
              <div className="flex items-center gap-2 px-1 pb-2 text-[12.5px] font-semibold">
                <span className="truncate">{labelFor(key)}</span>
                <span style={{ color: "var(--muted-foreground-faint)" }}>
                  {total != null && total > cards.length ? `${cards.length} of ${total}` : cards.length}
                </span>
              </div>
              <div className="space-y-2">
                {cards.map((row) => {
                  const idx = rows.indexOf(row);
                  return (
                    <KanbanCard key={idx} id={String(idx)} disabled={!canWrite} onOpen={() => onOpen(row)}>
                      <div className="font-medium truncate text-[13px]">{displayValue(meta, row)}</div>
                      <CardFields meta={meta} row={row} />
                    </KanbanCard>
                  );
                })}
              </div>
            </KanbanColumn>
          );
        })}
      </div>
      <DragOverlay>
        {activeRow ? (
          <Card size="sm" className="p-3 shadow-lg" style={{ width: 256 }}>
            <div className="font-medium truncate text-[13px]">{displayValue(meta, activeRow)}</div>
            <CardFields meta={meta} row={activeRow} />
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
