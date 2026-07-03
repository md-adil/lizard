"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dashboard } from "@/lib/types";

export default function DashboardsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const { data, isLoading } = useQuery<Dashboard[]>({
    queryKey: ["dashboards"],
    queryFn: async () => (await fetch("/api/dashboards")).json(),
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "New dashboard" }),
      });
      return res.json();
    },
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["dashboards"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/dashboards/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboards"] }),
  });

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <h1 className="text-xl font-semibold mb-1">Dashboards</h1>
      <p className="text-[13px] mb-6" style={{ color: "var(--text-dim)" }}>
        Grids of saved charts. Each panel can pull from a different database — or several at once.
      </p>

      <div className="flex gap-2 mb-6">
        <input
          className="input max-w-xs"
          placeholder="New dashboard name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create.mutate()}
        />
        <button className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
          ＋ Create
        </button>
      </div>

      {isLoading && <p style={{ color: "var(--text-dim)" }}>Loading…</p>}
      <div className="grid grid-cols-2 gap-3">
        {data?.map((d) => (
          <div key={d.id} className="panel px-5 py-4 flex items-center justify-between">
            <Link href={`/dashboards/${d.id}`} className="min-w-0">
              <div className="font-semibold text-[14px] truncate">{d.name}</div>
              <div className="text-[12px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                {d.panels.length} panel{d.panels.length === 1 ? "" : "s"}
                {d.refreshSeconds ? ` · refreshes every ${d.refreshSeconds}s` : ""}
              </div>
            </Link>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => confirm(`Delete dashboard "${d.name}"?`) && remove.mutate(d.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {data?.length === 0 && (
        <div className="panel px-6 py-10 text-center text-[13px]" style={{ color: "var(--text-dim)" }}>
          No dashboards yet. Create one here, or hit “Visualize” on any query result.
        </div>
      )}
    </div>
  );
}
