// Phase 8.9 — per-record comment (Lizard-side, keyed by a canonical PK string).
export interface RecordComment {
  id: string;
  authorId: string;
  authorName: string | null;
  connectionId: string;
  schema: string;
  table: string;
  pkKey: string;
  body: string;
  createdAt: string;
}

// Phase 8.3 — a saved view: named filter/sort/columns/view-type for one table.
export interface SavedView {
  id: string;
  ownerId: string;
  shared: boolean;
  connectionId: string;
  schema: string;
  table: string;
  name: string;
  config: SavedViewConfig;
  createdAt: string;
}

export interface SavedViewConfig {
  filterSet?: unknown; // FilterSet (lib/data/filters) — stored opaquely here
  sort?: string;
  sortDir?: "asc" | "desc";
  search?: string;
  columnVisibility?: Record<string, boolean>;
  viewType?: "table" | "kanban" | "gallery" | "calendar" | "tree";
  groupBy?: string | null;
  // Phase 8.8 — auto-refresh interval in ms; 0/undefined = off (the default).
  refreshMs?: number;
}
