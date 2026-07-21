"use client";

// Unified view switcher: built-in view types (table/kanban/gallery/...) and
// saved views (named filter+sort+column bundles, see lib/types/views.ts) in
// one tab row, replacing the old split between a Tabs row for types and a
// separate "▤ Views" dropdown for saved ones. Exactly one tab is ever
// active — clicking a built-in type switches render mode only (filters
// untouched) and deselects any saved view; clicking a saved view applies its
// full config and becomes the active tab. Saved views beyond a small inline
// count fold into a "More" dropdown, and a trailing "+" saves the current
// state as a new one — so this never renders "100s of tabs." Deleting a
// saved view lives on its own dedicated page (views/page.tsx), not as an
// inline "✕" on every tab — reached via the small settings icon here.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronDown, Settings } from "lucide-react";
import type { SavedView, SavedViewConfig } from "@/lib/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { viewsHref } from "@/components/browse/use-schema-param";
import { VIEW_LABELS, VIEW_ICONS, type ViewType } from "@/components/browse/view-types";

const MAX_INLINE_SAVED_VIEWS = 4;

export function ViewTabs({
  connectionId,
  connectionName,
  schema,
  table,
  builtInTypes,
  viewType,
  onSelectBuiltIn,
  currentConfig,
  onApplySavedView,
}: {
  connectionId: string;
  // The URL-facing connection name (params.connection) — connectionId is the
  // stable internal id the /api/views query is keyed by, a different value.
  connectionName: string;
  schema: string;
  table: string;
  builtInTypes: ViewType[];
  viewType: ViewType;
  onSelectBuiltIn: (v: ViewType) => void;
  currentConfig: SavedViewConfig;
  onApplySavedView: (config: SavedViewConfig) => void;
}) {
  const qc = useQueryClient();
  const key = ["views", connectionId, schema, table];
  // Which saved view (if any) is the active tab — a saved view is a whole
  // scene (viewType + filters + sort + ...), so it's tracked separately from
  // `viewType`, which a direct built-in-tab click can change on its own
  // without that counting as "still viewing" the saved view.
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");

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
    mutationFn: async (name: string): Promise<SavedView> => {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, schema, table, name, shared: true, config: currentConfig }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      return res.json();
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: key });
      setActiveViewId(created.id);
      setSaveOpen(false);
      setNewViewName("");
    },
  });

  function submitSave() {
    const name = newViewName.trim();
    if (name) save.mutate(name);
  }

  function selectSavedView(v: SavedView) {
    onApplySavedView(v.config);
    setActiveViewId(v.id);
  }

  const savedViews = views ?? [];
  const inline = savedViews.slice(0, MAX_INLINE_SAVED_VIEWS);
  const overflow = savedViews.slice(MAX_INLINE_SAVED_VIEWS);
  const activeValue = activeViewId ? `view:${activeViewId}` : viewType;

  return (
    <Tabs
      value={activeValue}
      onValueChange={(v) => {
        const value = v as string;
        if (value.startsWith("view:")) {
          const savedView = savedViews.find((x) => x.id === value.slice("view:".length));
          if (savedView) selectSavedView(savedView);
        } else {
          onSelectBuiltIn(value as ViewType);
          setActiveViewId(null);
        }
      }}
    >
      <TabsList>
        {builtInTypes.length > 1 &&
          builtInTypes.map((v) => {
            const Icon = VIEW_ICONS[v];
            return (
              <TabsTrigger key={v} value={v} className="gap-1.5">
                <Icon className="size-3.5" />
                {VIEW_LABELS[v]}
              </TabsTrigger>
            );
          })}
        {inline.map((v) => (
          <TabsTrigger key={v.id} value={`view:${v.id}`}>
            <span className="truncate max-w-24">{v.name}</span>
          </TabsTrigger>
        ))}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="inline-flex items-center gap-1 px-2 h-[calc(100%-1px)] rounded-md text-sm font-medium text-foreground/60 hover:text-foreground">
                  <ChevronDown className="size-3.5" /> More ({overflow.length})
                </button>
              }
            />
            <DropdownMenuContent align="start">
              {overflow.map((v) => (
                <DropdownMenuItem key={v.id} onClick={() => selectSavedView(v)}>
                  <span className="truncate">{v.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Popover
          open={saveOpen}
          onOpenChange={(o) => {
            setSaveOpen(o);
            if (!o) setNewViewName("");
          }}
        >
          <PopoverTrigger
            render={
              <button
                className="inline-flex ml-1 items-center justify-center size-6 rounded-md text-foreground/60 hover:text-foreground hover:bg-background"
                title="Save current view"
              >
                <Plus className="size-3.5" />
              </button>
            }
          />
          <PopoverContent align="start">
            <PopoverHeader>
              <PopoverTitle>Save current view</PopoverTitle>
            </PopoverHeader>
            <Input
              autoFocus
              placeholder="View name"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSave();
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!newViewName.trim() || save.isPending} onClick={submitSave}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <Link
          href={viewsHref({ connection: connectionName, schema, table })}
          className="inline-flex items-center justify-center size-6 rounded-md text-foreground/60 hover:text-foreground hover:bg-background"
          title="Manage saved views"
        >
          <Settings className="size-3.5" />
        </Link>
      </TabsList>
    </Tabs>
  );
}
