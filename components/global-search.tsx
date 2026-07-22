"use client";

// ⌘K / Ctrl+K cross-table search — see lib/data/global-search.ts for the
// scoping/column-narrowing design. Every table is searchable by default;
// an admin can exclude one via table customization ("Include in global
// search").
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { recordHref } from "@/components/browse/use-schema-param";
import type { GlobalSearchHit, GlobalSearchResult } from "@/lib/data/global-search";

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

// Groups preserve the hits' original (server-ranked) order — the group
// itself just appears at its first hit's position, not re-sorted.
function groupByConnection(hits: GlobalSearchHit[]): { connection: string; hits: GlobalSearchHit[] }[] {
  const groups: { connection: string; hits: GlobalSearchHit[] }[] = [];
  for (const h of hits) {
    let g = groups.find((g) => g.connection === h.connection);
    if (!g) {
      g = { connection: h.connection, hits: [] };
      groups.push(g);
    }
    g.hits.push(h);
  }
  return groups;
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const enabled = debounced.trim().length >= 2;

  // Which tables are searchable doesn't depend on the query text, so it's
  // resolved once per dialog-open (not on every keystroke) and cached
  // server-side under this id — see app/api/search/session/route.ts.
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessionLoading, setSessionLoading] = useState(false);
  useEffect(() => {
    if (!open) {
      setSessionId(undefined);
      setSessionLoading(false);
      return;
    }
    setQuery(""); // fresh input on every open, so a previous search doesn't linger
    setSessionLoading(true);
    let cancelled = false;
    fetch("/api/search/session", { method: "POST" })
      .then((res) => res.json())
      .then((data: { sessionId: string }) => {
        if (!cancelled) setSessionId(data.sessionId);
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const { data, isFetching } = useQuery<GlobalSearchResult>({
    queryKey: ["global-search", debounced, sessionId],
    // Passing `signal` through lets React Query's own cancellation (a new
    // keystroke superseding this query, or the dialog closing and unmounting
    // it) abort the underlying fetch — which the API route observes as
    // req.signal and uses to stop fanning out to more tables server-side
    // (see runGlobalSearch/runWithBudget in lib/data/global-search.ts).
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(debounced)}&sessionId=${encodeURIComponent(sessionId!)}`,
        { signal },
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: enabled && !!sessionId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col gap-3 p-3 sm:max-w-none"
        style={{ width: 560, maxWidth: "92vw", maxHeight: "70vh" }}
      >
        <DialogTitle className="sr-only">Global search</DialogTitle>
        <InputGroup className="shrink-0">
          <InputGroupAddon align="inline-start">
            {isFetching || sessionLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            placeholder={sessionLoading ? "Preparing search…" : "Search across tables…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {!enabled && (
            <p className="px-2 py-6 text-center text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
              Type at least 2 characters. Tables excluded from global search in table customization are skipped.
            </p>
          )}
          {enabled && data && data.hits.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
              No matches{data.scannedTables === 0 ? " — no readable tables to search" : ""}.
            </p>
          )}
          {data &&
            groupByConnection(data.hits).map((group) => (
              <div key={group.connection} className="mb-2">
                <div
                  className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--muted-foreground-faint)" }}
                >
                  {group.connection}
                </div>
                {group.hits.map((h, i) => (
                  <Link
                    key={`${h.schema ?? ""}.${h.table}.${i}`}
                    href={recordHref({
                      connection: h.connection,
                      schema: h.schema,
                      table: h.table,
                      params: { pk: JSON.stringify(h.pk) },
                    })}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hoverable"
                  >
                    <span className="truncate text-[13px]">{h.value || "∅"}</span>
                    <span
                      className="code shrink-0 truncate max-w-48"
                      style={{ fontSize: 10.5, color: "var(--muted-foreground-faint)" }}
                      title={`${h.connection}.${h.schema ? `${h.schema}.` : ""}${h.table}.${h.matchedColumn}`}
                    >
                      {h.schema ? `${h.schema}.` : ""}
                      {h.table}.{h.matchedColumn}
                    </span>
                  </Link>
                ))}
              </div>
            ))}
        </div>

        {data && data.partial && (
          <p className="shrink-0 text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
            Search timed out before scanning all <strong>{data.scannedTables}</strong> eligible tables — results may be
            incomplete.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
