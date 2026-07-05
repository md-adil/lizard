"use client";

// Combined search input + filter panel toolbar. Used in the table browser
// and the reference picker modal. The parent owns `search` (committed value)
// and `filterSet`; this component owns the draft `searchInput` state.
import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import type { ColumnMeta } from "./useTableMeta";
import type { FilterSet } from "@/lib/data/filters";
import { isComplete } from "@/lib/data/filters";
import { FilterPanel } from "./filter-builder";
import { Button } from "@/components/ui/button";

const TEXT_LIKE = new Set([
  "text",
  "varchar",
  "bpchar",
  "citext",
  "name",
  "char",
]);
const SEARCH_ROW_LIMIT = 500_000;

interface Props {
  columns: ColumnMeta[];
  rowEstimate?: number;
  filterSet: FilterSet;
  onFilterChange: (set: FilterSet) => void;
  search: string;
  onSearchChange: (committed: string) => void;
  isLoading?: boolean;
}

export function TableSearchBar({
  columns,
  rowEstimate = 0,
  filterSet,
  onFilterChange,
  search,
  onSearchChange,
  isLoading = false,
}: Props) {
  const [searchInput, setSearchInput] = useState(search);
  const [filterOpen, setFilterOpen] = useState(false);

  const textColCount = columns.filter((c) =>
    TEXT_LIKE.has(c.col.udtName),
  ).length;
  const tooLarge = rowEstimate >= SEARCH_ROW_LIMIT;
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
        <Button variant="outline" className="shrink-0"
         
          style={
            activeCount
              ? { color: "var(--accent)", borderColor: "var(--accent)" }
              : {}
          }
          onClick={() => setFilterOpen((o) => !o)}
        >
          ⛃ Filter
          {activeCount > 0 && (
            <span
              className="ml-1 tag"
              style={{ fontSize: 10, color: "var(--accent)" }}
            >
              {activeCount}
            </span>
          )}
          <span style={{ color: "var(--text-faint)", fontSize: 10 }}>
            {filterOpen ? "▲" : "▼"}
          </span>
        </Button>

        {/* search input group: input + search button joined */}
        <div
          className="flex flex-1"
          style={{
            border: "1px solid var(--border-strong)",
            borderRadius: 7,
            overflow: "hidden",
            opacity: tooLarge || textColCount === 0 ? 0.5 : 1,
          }}
        >
          <div className="relative flex-1">
            <input
              className="input"
              style={{
                border: "none",
                borderRadius: 0,
                width: "100%",
                paddingRight: searchInput ? 28 : undefined,
              }}
              placeholder={
                tooLarge
                  ? "Search disabled — table too large, use filters"
                  : textColCount === 0
                    ? "No text columns to search"
                    : `Search ${textColCount} text column${textColCount !== 1 ? "s" : ""}…`
              }
              disabled={tooLarge || textColCount === 0}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
            {searchInput && (
              <Button variant="ghost" className="absolute right-2 top-1/2 -translate-y-1/2"
               
                style={{ color: "var(--text-faint)", fontSize: 12 }}
                title="Clear search"
                onClick={clear}
              >
                ✕
              </Button>
            )}
          </div>

          <Button
           
            style={{
              borderRadius: 0,
              border: "none",
              borderLeft: "1px solid var(--accent)",
              padding: "6px 12px",
            }}
            disabled={tooLarge || textColCount === 0 || isLoading}
            title="Search (Enter)"
            onClick={commit}
          >
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )}
          </Button>
        </div>
      </div>

      {/* filter panel — inline, full width, below the toolbar row */}
      {filterOpen && (
        <FilterPanel
          columns={columns}
          value={filterSet}
          onChange={onFilterChange}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}
