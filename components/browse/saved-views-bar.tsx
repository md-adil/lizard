"use client";

// Phase 8.3 — saved views: apply / save / delete named bundles of
// filter+sort+search+column-visibility for one table. Lizard-side only.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SavedView, SavedViewConfig } from "@/lib/types";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function SavedViewsBar({
  connectionId,
  schema,
  table,
  currentConfig,
  onApply,
}: {
  connectionId: string;
  schema: string;
  table: string;
  currentConfig: SavedViewConfig;
  onApply: (config: SavedViewConfig) => void;
}) {
  const qc = useQueryClient();
  const { user, isAdmin } = useAuth();
  const key = ["views", connectionId, schema, table];

  const { data: views } = useQuery<SavedView[]>({
    queryKey: key,
    queryFn: async () => {
      const qs = new URLSearchParams({ connectionId, schema, table });
      const res = await fetch(`/api/views?${qs}`);
      if (!res.ok) throw new Error("failed to load views");
      return res.json();
    },
    enabled: !!connectionId,
  });

  const save = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          schema,
          table,
          name,
          shared: true,
          config: currentConfig,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/views/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  function saveCurrent() {
    const name = window.prompt("Save current view as:");
    if (name?.trim()) save.mutate(name.trim());
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        ▤ Views{views?.length ? ` (${views.length})` : ""}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views?.length === 0 && (
            <div className="px-2 py-1.5 text-[12px]" style={{ color: "var(--muted-foreground-faint)" }}>
              None yet
            </div>
          )}
          {views?.map((v) => (
            <DropdownMenuItem
              key={v.id}
              closeOnClick={false}
              onClick={() => onApply(v.config)}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{v.name}</span>
              {(v.ownerId === user?.id || isAdmin) && (
                <button
                  className="shrink-0"
                  style={{ color: "var(--muted-foreground-faint)" }}
                  title="Delete view"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove.mutate(v.id);
                  }}
                >
                  ✕
                </button>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={saveCurrent}>＋ Save current view…</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
