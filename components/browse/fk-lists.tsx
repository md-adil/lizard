"use client";

// Read-only foreign-key lists (virtual / native / incoming) for one table —
// shared by the customize page's Relationships tab (which renders its own
// add-relationship form beside this) and the browse grid page's Info sheet
// (fully read-only, so it omits onDeleteVirtualFk).
import type { TableInfo, VirtualFk } from "@/lib/types";
import { vfkSummary } from "@/lib/introspect/virtual-fk";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function ForeignKeyLists({
  table,
  schemaTables,
  virtualFks,
  resolveConnectionName,
  deletingId = null,
  onDeleteVirtualFk,
  saving = false,
}: {
  table: TableInfo;
  // Every table in this table's own schema — scanned for real FKs pointing
  // back at this table, so the "incoming" list has something to read.
  schemaTables: TableInfo[];
  virtualFks: VirtualFk[];
  resolveConnectionName: (id: string) => string;
  deletingId?: string | null;
  // Omit for a read-only rendering (e.g. the Info sheet) — hides the delete button.
  onDeleteVirtualFk?: (id: string) => void;
  // A new virtual FK is being submitted — shows a skeleton row and suppresses
  // the "No relationships yet" flash while the list is about to grow.
  saving?: boolean;
}) {
  // Real FKs on *other* tables in this schema that point back at this table —
  // read-only, same reasoning as the outgoing native FK list below (DB-enforced,
  // not editable here).
  const incomingFks = schemaTables
    .filter((t) => t.name !== table.name)
    .flatMap((t) =>
      t.foreignKeys
        .filter((fk) => fk.referencedSchema === table.schema && fk.referencedTable === table.name)
        .map((fk) => ({ fromTable: t.name, fk })),
    );

  return (
    <div>
      <div
        className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: "var(--muted-foreground-faint)" }}
      >
        Virtual relationships
      </div>
      {virtualFks.length === 0 && !saving && (
        <p className="text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
          No relationships yet.
        </p>
      )}
      {virtualFks.map((v) => (
        <Card
          key={v.id}
          size="sm"
          className={`px-3 py-2.5 mb-2 flex-row items-start justify-between gap-2 transition-opacity ${
            deletingId === v.id ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          <div className="min-w-0">
            {v.label && <div className="font-medium mb-0.5">{v.label}</div>}
            <span className="code wrap-break-word" style={{ fontSize: 11.5 }}>
              {v.fromSchema}.{v.fromTable} → {vfkSummary(v, resolveConnectionName)}
            </span>
          </div>
          {onDeleteVirtualFk &&
            (deletingId === v.id ? (
              <span className="text-[12px] text-muted-foreground animate-pulse shrink-0 self-center">Deleting…</span>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="secondary" size="icon-sm" className="shrink-0" disabled={deletingId !== null}>
                      ✕
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Relationship</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete this relationship? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => onDeleteVirtualFk(v.id)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ))}
        </Card>
      ))}

      {saving && (
        <Card size="sm" className="px-3 py-2.5 mb-2 opacity-50 animate-pulse flex-row items-center gap-2">
          <div className="flex-1 space-y-1">
            <div className="h-4 bg-muted rounded w-1/4" />
            <div className="h-3 bg-muted rounded w-3/4" />
          </div>
        </Card>
      )}

      {table.foreignKeys.length > 0 && (
        <div className="mt-4">
          <div
            className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: "var(--muted-foreground-faint)" }}
          >
            Native foreign keys (from the database)
          </div>
          {table.foreignKeys.map((fk) => (
            <Card key={fk.constraintName} size="sm" className="px-3 py-2.5 mb-2">
              <span className="code wrap-break-word" style={{ fontSize: 11.5 }}>
                {fk.columns.join(", ")} → {fk.referencedSchema}.{fk.referencedTable} (
                {fk.referencedColumns.join(", ")})
              </span>
            </Card>
          ))}
        </div>
      )}

      {incomingFks.length > 0 && (
        <div className="mt-4">
          <div
            className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: "var(--muted-foreground-faint)" }}
          >
            Incoming foreign keys (from other tables)
          </div>
          {incomingFks.map(({ fromTable, fk }) => (
            <Card key={`${fk.constraintName}-${fromTable}`} size="sm" className="px-3 py-2.5 mb-2">
              <span className="code wrap-break-word" style={{ fontSize: 11.5 }}>
                {fromTable}.{fk.columns.join(", ")} → {fk.referencedColumns.join(", ")}
              </span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
