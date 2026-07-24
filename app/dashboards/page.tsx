"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Dashboard } from "@/lib/types";
import { useDashboards } from "@/components/charts/use-dashboards";
import { Breadcrumbs } from "@/components/breadcrumbs";

const UNDO_DELAY_MS = 5000;
// Keyed by dashboard id. Deliberately module-level, not component state: a
// setTimeout survives unmount, but if the id→timeout mapping lived in
// useState/useRef, navigating away from this page before the undo window
// closes would lose the ability to know the delete is still pending.
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();

export default function DashboardsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isLoading } = useDashboards();

  // Creating lands straight on the new dashboard in edit mode (rename, add
  // panels there) instead of leaving an empty card in this list.
  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New dashboard" }),
      });
      if (!res.ok) throw new Error("Failed to create dashboard");
      return res.json() as Promise<Dashboard>;
    },
    onSuccess: (d) => {
      useDashboards.invalidate(qc);
      router.push(`/dashboards/${d.id}?edit=1`);
    },
  });

  const togglePin = async (d: Dashboard) => {
    // Optimistic — the sidebar reads the same cache, so the pin appears there
    // instantly; the server call just persists it.
    qc.setQueryData<Dashboard[]>(useDashboards.key, (old) =>
      old?.map((x) => (x.id === d.id ? { ...x, pinned: !d.pinned } : x)),
    );
    await fetch(`/api/dashboards/${d.id}/pin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !d.pinned }),
    });
    useDashboards.invalidate(qc);
  };

  const deleteWithUndo = (d: Dashboard, index: number) => {
    qc.setQueryData<Dashboard[]>(useDashboards.key, (old) => old?.filter((x) => x.id !== d.id));
    const timeout = setTimeout(async () => {
      pendingDeletes.delete(d.id);
      await fetch(`/api/dashboards/${d.id}`, { method: "DELETE" });
    }, UNDO_DELAY_MS);
    pendingDeletes.set(d.id, timeout);
    toast(`Deleted "${d.name}"`, {
      duration: UNDO_DELAY_MS,
      action: {
        label: "Undo",
        onClick: () => {
          const pending = pendingDeletes.get(d.id);
          if (pending) clearTimeout(pending);
          pendingDeletes.delete(d.id);
          // Never actually left the server — restore from cache, no refetch.
          qc.setQueryData<Dashboard[]>(useDashboards.key, (old) => {
            if (old?.some((x) => x.id === d.id)) return old;
            const next = [...(old ?? [])];
            next.splice(index, 0, d);
            return next;
          });
        },
      },
    });
  };

  return (
    <div className="container mx-auto">
      <Breadcrumbs className="mb-4" items={[{ label: "Home", link: "/" }, { label: "Dashboards" }]} />
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold mb-1">Dashboards</h1>
          <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
            Grids of saved charts. Each panel can pull from a different database — or several at once.
          </p>
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? "Creating…" : "＋ New dashboard"}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {data?.map((d, i) => (
            <Link
              key={d.id}
              href={`/dashboards/${d.id}`}
              className="panel px-5 py-4 flex items-center justify-between cursor-pointer transition-shadow hover:ring-2 hover:ring-[var(--primary)]"
            >
              <div className="min-w-0">
                <div className="font-semibold text-[14px] truncate">{d.name}</div>
                <div className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  {d.panels.length} panel{d.panels.length === 1 ? "" : "s"}
                  {d.refreshSeconds ? ` · refreshes every ${d.refreshSeconds}s` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={d.pinned ? `Unpin "${d.name}" from sidebar` : `Pin "${d.name}" to sidebar`}
                  title={d.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                  onClick={(e) => {
                    // inside the card link — pin must not also navigate
                    e.preventDefault();
                    e.stopPropagation();
                    togglePin(d);
                  }}
                >
                  <Pin className={d.pinned ? "size-3.5 fill-current" : "size-3.5"} />
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={`Delete dashboard "${d.name}"`}
                  onClick={(e) => {
                    // inside the card link — delete must not also navigate
                    e.preventDefault();
                    e.stopPropagation();
                    deleteWithUndo(d, i);
                  }}
                >
                  ✕
                </Button>
              </div>
            </Link>
          ))}
        </div>
      )}
      {!isLoading && data?.length === 0 && (
        <div className="panel px-6 py-10 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          No dashboards yet. Create one here, or hit “Visualize” on any query result.
        </div>
      )}
    </div>
  );
}
