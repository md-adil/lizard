"use client";

// Combined search input + filter panel toolbar. Used in the table browser
// and the reference picker modal. The parent owns `search` (committed value)
// and `filterSet`; this component owns the draft `searchInput` state.
import { useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import type { ColumnMeta } from "./useTableMeta";
import type { FilterSet } from "@/lib/data/filters";
import { isComplete } from "@/lib/data/filters";
import { FilterPanel, type FilterTarget } from "./filter-builder";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

interface Props {
  columns: ColumnMeta[];
  target: FilterTarget;
  // Which columns the server will actually search (lib/data/search-match.ts
  // restricts to indexed columns only — no row-count gate needed anymore,
  // since an indexed lookup doesn't get slower as the table grows).
  indexedColumns: string[];
  filterSet: FilterSet;
  onFilterChange: (set: FilterSet) => void;
  search: string;
  onSearchChange: (committed: string) => void;
  isLoading?: boolean;
}

export function TableSearchBar({
  columns,
  target,
  indexedColumns,
  filterSet,
  onFilterChange,
  search,
  onSearchChange,
  isLoading = false,
}: Props) {
  const [searchInput, setSearchInput] = useState(search);
  const [filterOpen, setFilterOpen] = useState(false);

  const indexedColSet = new Set(indexedColumns);
  const searchableColCount = columns.filter((c) => indexedColSet.has(c.col.name)).length;
  const activeCount = filterSet.conditions.filter(isComplete).length;

  const commit = () => onSearchChange(searchInput);
  const clear = () => {
    setSearchInput("");
    onSearchChange("");
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        {/* filter toggle button — left */}
        <Button
          variant="secondary"
          className="shrink-0"

          style={activeCount ? { color: "var(--primary)", borderColor: "var(--primary)" } : {}}
          onClick={() => setFilterOpen((o) => !o)}
        >
          ⛃ Filter
          {activeCount > 0 && (
            <span className="ml-1 tag" style={{ fontSize: 10, color: "var(--primary)" }}>
              {activeCount}
            </span>
          )}
          <span style={{ color: "var(--muted-foreground-faint)", fontSize: 10 }}>{filterOpen ? "▲" : "▼"}</span>
        </Button>

        {/* search input group: icon + input + clear + search button joined */}
        <div className="flex flex-1" style={{ opacity: searchableColCount === 0 ? 0.5 : 1 }}>
          <InputGroup className="rounded-r-none">
            <InputGroupAddon align="inline-start">
              <Search className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={
                searchableColCount === 0
                  ? "No indexed columns to search"
                  : `Search ${searchableColCount} indexed column${searchableColCount !== 1 ? "s" : ""}…`
              }
              disabled={searchableColCount === 0}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
            {searchInput && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" title="Clear search" aria-label="Clear search" onClick={clear}>
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          <Button
            className="rounded-l-none border-l-0"
            disabled={searchableColCount === 0 || isLoading}
            title="Search (Enter)"
            onClick={commit}
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          </Button>
        </div>
      </div>

      {/* filter panel — inline, full width, below the toolbar row */}
      {filterOpen && (
        <FilterPanel
          columns={columns}
          target={target}
          value={filterSet}
          onChange={onFilterChange}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}
