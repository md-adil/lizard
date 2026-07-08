"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ConnectionForm, type ConnectionRow } from "@/app/connection-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EngineIcon, ENGINE_LABELS } from "@/components/engine-icon";

interface ConnectionWithStatus extends ConnectionRow {
  status: { read: string | null; write: string | null };
}

export function ConnectionsTab() {
  const qc = useQueryClient();
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<ConnectionRow | null>(null);

  const { data: connections, isLoading } = useQuery<ConnectionWithStatus[]>({
    queryKey: ["connections"],
    queryFn: async () => (await fetch("/api/connections")).json(),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/connections/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Connections</h2>
        <Button
          onClick={() => {
            setEditing(null);
            setFormMode("create");
          }}
        >
          + Add connection
        </Button>
      </div>
      <p className="text-[13px] mb-6" style={{ color: "var(--muted-foreground)" }}>
        Register each microservice&apos;s database (Postgres, MySQL, or MongoDB). Paste a connection URI or fill the
        fields, test it, then Lizard introspects every schema and makes the whole fleet browsable, editable, and
        queryable.
      </p>

      {isLoading && <p style={{ color: "var(--muted-foreground)" }}>Loading…</p>}

      <div className="space-y-3">
        {connections?.map((c) => (
          <Card key={c.id} className="px-5 py-4 flex items-center justify-between">
            <Link href={`/browse/${c.name}`} className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2">
                <EngineIcon engine={c.engine} className="size-4 shrink-0" />
                <span className="font-semibold text-[14px]" title={ENGINE_LABELS[c.engine]}>
                  {c.name}
                </span>
                {c.status.read === null ? (
                  <span className="tag" style={{ color: "var(--success)" }}>
                    read ok
                  </span>
                ) : (
                  <span className="tag" style={{ color: "var(--destructive)" }} title={c.status.read}>
                    read failed
                  </span>
                )}
                {c.hasWrite ? (
                  c.status.write === null ? (
                    <span className="tag" style={{ color: "var(--success)" }}>
                      write ok
                    </span>
                  ) : (
                    <span className="tag" style={{ color: "var(--destructive)" }} title={c.status.write ?? ""}>
                      write failed
                    </span>
                  )
                ) : (
                  <span className="tag">read-only</span>
                )}
              </div>
              <div className="text-[12.5px] mt-1 code" style={{ color: "var(--muted-foreground)" }}>
                {c.host}:{c.port}/{c.database}
              </div>
            </Link>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(c);
                  setFormMode("edit");
                }}
              >
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (confirm(`Remove connection "${c.name}"? (The database itself is untouched.)`)) {
                    deleteMutation.mutate(c.id);
                  }
                }}
              >
                Remove
              </Button>
            </div>
          </Card>
        ))}
        {connections?.length === 0 && (
          <Card className="px-6 py-10 text-center">
            <p className="text-[14px] mb-1">No connections yet</p>
            <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              Add your first Postgres database to get a browsable console in seconds.
            </p>
          </Card>
        )}
      </div>

      {formMode && (
        <ConnectionForm
          mode={formMode}
          initial={editing ?? undefined}
          onClose={() => {
            setFormMode(null);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
