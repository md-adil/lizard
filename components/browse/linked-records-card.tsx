"use client";

// Phase 8.5 — M2M linked records. A junction table (two single-column FKs) is
// rendered as a chip list on both parent records; add/remove just insert or
// delete a junction row through the existing generic row create/delete
// endpoints — no new write path needed.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCatalog, buildTableMeta } from "./useTableMeta";
import { ReferencePickerModal } from "./reference-picker-modal";
import { Button } from "@/components/ui/button";

interface Target {
  connection: string;
  junctionSchema: string;
  junctionTable: string;
  selfFkColumn: string;
  otherFkColumn: string;
  otherSchema: string;
  otherTable: string;
}

export function LinkedRecordsCard({
  title,
  target,
  selfValue,
}: {
  title: string;
  target: Target;
  selfValue: unknown;
}) {
  const qc = useQueryClient();
  const { data: catalog } = useCatalog();
  const [linking, setLinking] = useState(false);

  const junctionMeta = catalog
    ? buildTableMeta(
        catalog,
        target.connection,
        target.junctionSchema,
        target.junctionTable,
      )
    : null;

  const key = [
    "linked",
    target.connection,
    target.junctionSchema,
    target.junctionTable,
    target.selfFkColumn,
    target.otherFkColumn,
    String(selfValue),
  ];

  const { data } = useQuery<{ rows: Record<string, unknown>[] }>({
    queryKey: key,
    queryFn: async () => {
      const qs = new URLSearchParams({
        selfFkColumn: target.selfFkColumn,
        otherFkColumn: target.otherFkColumn,
        otherSchema: target.otherSchema,
        otherTable: target.otherTable,
        selfValue: String(selfValue),
      });
      const res = await fetch(
        `/api/data/${target.connection}/${target.junctionSchema}/${target.junctionTable}/linked?${qs}`,
      );
      if (!res.ok) throw new Error("failed to load linked records");
      return res.json();
    },
    enabled: selfValue != null && !!junctionMeta,
  });

  async function unlink(junctionRow: Record<string, unknown>) {
    if (!junctionMeta) return;
    const pk: Record<string, unknown> = {};
    for (const k of junctionMeta.table.primaryKey) pk[k] = junctionRow[k];
    await fetch(
      `/api/data/${target.connection}/${target.junctionSchema}/${target.junctionTable}/row`,
      { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pk }) },
    );
    qc.invalidateQueries({ queryKey: key });
  }

  async function link(otherId: string) {
    await fetch(
      `/api/data/${target.connection}/${target.junctionSchema}/${target.junctionTable}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [target.selfFkColumn]: selfValue,
          [target.otherFkColumn]: otherId,
        }),
      },
    );
    qc.invalidateQueries({ queryKey: key });
    setLinking(false);
  }

  const rows = data?.rows ?? [];

  return (
    <div className="panel p-4 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[13.5px] font-semibold truncate">{title}</span>
        <span className="tag code" style={{ fontSize: 10 }}>
          {target.otherSchema}.{target.otherTable}
        </span>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setLinking(true)}>
          ＋ Link
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--muted-foreground-faint)" }}>
          Nothing linked yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r, i) => (
            <span key={i} className="tag" style={{ color: "var(--foreground)" }}>
              {String(r.__label ?? r.__other_id)}
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-1.5"
                style={{ color: "var(--muted-foreground-faint)" }}
                title="Unlink"
                onClick={() => unlink(r)}
              >
                ✕
              </Button>
            </span>
          ))}
        </div>
      )}

      {linking && (
        <ReferencePickerModal
          target={{
            connection: target.connection,
            schema: target.otherSchema,
            table: target.otherTable,
            column:
              junctionMeta?.columns.find(
                (c) => c.col.name === target.otherFkColumn,
              )?.ref?.column ?? "",
          }}
          title={`Link ${target.otherTable}`}
          onPick={(id) => link(id)}
          onClose={() => setLinking(false)}
        />
      )}
    </div>
  );
}
