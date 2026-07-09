"use client";

// Phase 8.5 — M2M linked records. A junction table (two single-column FKs) is
// rendered as a chip list on both parent records; add/remove just insert or
// delete a junction row through the existing generic row create/delete
// endpoints — no new write path needed.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTableMeta } from "./useTableMeta";
import { dataApiUrl } from "./data-api";
import { ReferencePickerModal } from "./reference-picker-modal";
import { Button } from "@/components/ui/button";

// junctionSchema/otherSchema are undefined when this connection has no real
// schema (see supportsSchemas) — junction and "other" are always the same
// connection for an M2M relationship, so both share that one resolution,
// already decided by the caller (record page's `relations` construction).
interface Target {
  connection: string;
  junctionSchema: string | undefined;
  junctionTable: string;
  selfFkColumn: string;
  otherFkColumn: string;
  otherSchema: string | undefined;
  otherTable: string;
}

export function LinkedRecordsCard({ title, target, selfValue }: { title: string; target: Target; selfValue: unknown }) {
  const qc = useQueryClient();
  const [linking, setLinking] = useState(false);

  const { meta: junctionMeta } = useTableMeta(target.connection, target.junctionSchema, target.junctionTable);

  const key = [
    "linked",
    target.connection,
    target.junctionSchema,
    target.junctionTable,
    target.selfFkColumn,
    target.otherFkColumn,
    String(selfValue),
  ];

  // every call here targets the junction table on the junction's connection
  const junctionUrl = (path?: string, params?: Record<string, string | undefined>) =>
    dataApiUrl({
      connection: target.connection,
      table: target.junctionTable,
      path,
      schema: target.junctionSchema,
      params,
    });

  const { data } = useQuery<{ rows: Record<string, unknown>[] }>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(
        junctionUrl("linked", {
          selfFkColumn: target.selfFkColumn,
          otherFkColumn: target.otherFkColumn,
          otherSchema: target.otherSchema,
          otherTable: target.otherTable,
          selfValue: String(selfValue),
        }),
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
    await fetch(junctionUrl("row"), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pk }),
    });
    qc.invalidateQueries({ queryKey: key });
  }

  async function link(otherId: string) {
    await fetch(junctionUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [target.selfFkColumn]: selfValue,
        [target.otherFkColumn]: otherId,
      }),
    });
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
            column: junctionMeta?.columns.find((c) => c.col.name === target.otherFkColumn)?.ref?.column ?? "",
          }}
          title={`Link ${target.otherTable}`}
          onPick={(id) => link(id)}
          onClose={() => setLinking(false)}
        />
      )}
    </div>
  );
}
