"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ConnectionForm, type ConnectionRow } from "@/app/connection-form";
import { Button } from "@/components/ui/button";

interface ConnectionWithStatus extends ConnectionRow {
  status: { read: string | null; write: string | null };
}

export default function ConnectionsPage() {
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
    <div className="max-w-4xl mx-auto px-8 py-10">
      <div
        className="mb-10 pb-8"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl select-none">🦎</span>
          <h1 className="text-2xl font-semibold tracking-tight">Lizard</h1>
        </div>
        <p
          className="text-[14.5px] leading-relaxed max-w-xl"
          style={{ color: "var(--text-dim)" }}
        >
          A multi-tenant database console for Postgres. Register any number of
          databases, then browse every schema and table — filter, sort, edit
          rows, follow foreign keys, and explore relationships — without writing
          a line of SQL.
        </p>
        <div className="flex gap-6 mt-5">
          {[
            {
              icon: "🔍",
              label: "Browse tables",
              desc: "Filter, sort, paginate any table",
            },
            {
              icon: "✏️",
              label: "Edit rows",
              desc: "Create, update, delete with a form",
            },
            {
              icon: "🔗",
              label: "Follow relations",
              desc: "Traverse FKs across services",
            },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="flex items-start gap-2.5">
              <span className="text-lg leading-none mt-0.5">{icon}</span>
              <div>
                <div className="text-[13px] font-medium">{label}</div>
                <div
                  className="text-[12px]"
                  style={{ color: "var(--text-faint)" }}
                >
                  {desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold">Connections</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setFormMode("create");
          }}
        >
          + Add connection
        </Button>
      </div>
      <p className="text-[13px] mb-6" style={{ color: "var(--text-dim)" }}>
        Register each microservice&apos;s Postgres database. Paste a connection
        URI or fill the fields, test it, then Lizard introspects every schema
        and makes the whole fleet browsable, editable, and queryable.
      </p>

      {isLoading && <p style={{ color: "var(--text-dim)" }}>Loading…</p>}

      <div className="space-y-3">
        {connections?.map((c) => (
          <div
            key={c.id}
            className="panel px-5 py-4 flex items-center justify-between"
          >
            <Link href={`/browse/${c.name}`} className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[14px]">{c.name}</span>
                {c.status.read === null ? (
                  <span className="tag" style={{ color: "var(--green)" }}>
                    read ok
                  </span>
                ) : (
                  <span
                    className="tag"
                    style={{ color: "var(--red)" }}
                    title={c.status.read}
                  >
                    read failed
                  </span>
                )}
                {c.hasWrite ? (
                  c.status.write === null ? (
                    <span className="tag" style={{ color: "var(--green)" }}>
                      write ok
                    </span>
                  ) : (
                    <span
                      className="tag"
                      style={{ color: "var(--red)" }}
                      title={c.status.write ?? ""}
                    >
                      write failed
                    </span>
                  )
                ) : (
                  <span className="tag">read-only</span>
                )}
              </div>
              <div
                className="text-[12.5px] mt-1 code"
                style={{ color: "var(--text-dim)" }}
              >
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
                  if (
                    confirm(
                      `Remove connection "${c.name}"? (The database itself is untouched.)`,
                    )
                  ) {
                    deleteMutation.mutate(c.id);
                  }
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        {connections?.length === 0 && (
          <div className="panel px-6 py-10 text-center">
            <p className="text-[14px] mb-1">No connections yet</p>
            <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
              Add your first Postgres database to get a browsable console in
              seconds.
            </p>
          </div>
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
