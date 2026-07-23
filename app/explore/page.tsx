"use client";

// Full-page replacement for the old ⌘K search popup (components/global-search.tsx,
// still used by nothing else — its session/debounce/grouping logic is inlined
// below since a page tab has no "close on select" concept the modal needed).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, Play, History as HistoryIcon } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { SqlEditor } from "@/components/ui/sql-editor";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ResultGrid } from "@/components/ai/result-grid";
import { NullValue } from "@/components/browse/null-value";
import { useCatalog } from "@/components/browse/use-catalog";
import { recordHref } from "@/components/browse/use-schema-param";
import type { GlobalSearchHit, GlobalSearchResult } from "@/lib/data/global-search";
import type { QueryResult } from "@/lib/types";

const ALL_CONNECTIONS = "__all__";

type SqlMode = "single" | "federated";

interface SearchHistoryEntry {
  type: "search";
  text: string;
  connFilter: string;
}
interface SqlHistoryEntry {
  type: "sql";
  text: string;
  mode: SqlMode;
  connections: string[];
}
type HistoryEntry = (SearchHistoryEntry | SqlHistoryEntry) & { ranAt: number };

// Client-only, like the sidebar's other per-browser prefs (loadedSchemasKey
// etc.) — there's no server-side concept of "queries this user has typed".
const HISTORY_KEY = "lizard.explore.history";
const HISTORY_LIMIT = 100;

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
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

function SearchTab({
  onRun,
  restore,
}: {
  onRun: (entry: SearchHistoryEntry) => void;
  restore: (SearchHistoryEntry & { nonce: number }) | null;
}) {
  const { data: catalog } = useCatalog();
  const connections = (catalog?.connections ?? []).filter((c) => !c.error);

  // Defaults to the first connection (not "All") once the catalog loads —
  // only once, so picking "All" or another connection afterward sticks.
  const firstConnectionName = connections[0]?.connectionName;
  const [connFilter, setConnFilter] = useState<string>(ALL_CONNECTIONS);
  const defaulted = useRef(false);
  useEffect(() => {
    if (!defaulted.current && firstConnectionName) {
      setConnFilter(firstConnectionName);
      defaulted.current = true;
    }
  }, [firstConnectionName]);

  const [query, setQuery] = useState("");
  // Only a submit (Enter or the Search button) moves `query` into
  // `submitted` — the query fires off that, not every keystroke.
  const [submitted, setSubmitted] = useState("");
  const enabled = submitted.trim().length >= 2;

  useEffect(() => {
    if (!restore) return;
    setQuery(restore.text);
    setSubmitted(restore.text);
    setConnFilter(restore.connFilter);
    // nonce alone identifies a restore event — text/connFilter are read once
    // from the same object, not independent reactive deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore?.nonce]);

  const doSearch = () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSubmitted(query);
    onRun({ type: "search", text: query, connFilter });
  };

  // Which tables are searchable doesn't depend on the query text, so it's
  // resolved once (not on every keystroke) and cached server-side under this
  // id — see app/api/search/session/route.ts.
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessionLoading, setSessionLoading] = useState(true);
  useEffect(() => {
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
  }, []);

  const { data, isFetching } = useQuery<GlobalSearchResult>({
    queryKey: ["global-search", submitted, sessionId],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(submitted)}&sessionId=${encodeURIComponent(sessionId!)}`,
        { signal },
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: enabled && !!sessionId,
  });

  // The session always scans every readable connection — the chip filter
  // narrows the already-fetched hits client-side rather than re-scoping the
  // (expensive) server-side table resolution per connection.
  const hits = data ? (connFilter === ALL_CONNECTIONS ? data.hits : data.hits.filter((h) => h.connection === connFilter)) : [];

  return (
    <div>
      <Card className="mb-3">
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Chip active={connFilter === ALL_CONNECTIONS} onClick={() => setConnFilter(ALL_CONNECTIONS)}>
              All
            </Chip>
            {connections.map((c) => (
              <Chip key={c.connectionId} active={connFilter === c.connectionName} onClick={() => setConnFilter(c.connectionName)}>
                {c.connectionName}
              </Chip>
            ))}
          </div>

          <InputGroup className="w-full">
            <InputGroupAddon align="inline-start">
              {isFetching || sessionLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              placeholder={sessionLoading ? "Preparing search…" : "Search across tables… (Enter to search)"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch();
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                title="Search"
                aria-label="Search"
                disabled={query.trim().length < 2}
                onClick={doSearch}
              >
                <Search className="size-3.5" />
                Search
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {!enabled && (
            <p className="px-2 py-6 text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
              Press Enter or click Search to look across every readable table. Tables excluded from global search in
              table customization are skipped.
            </p>
          )}
          {enabled && data && hits.length === 0 && (
            <p className="px-2 py-6 text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
              No matches{data.scannedTables === 0 ? " — no readable tables to search" : ""}.
            </p>
          )}
          {groupByConnection(hits).map((group) => (
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
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hoverable"
                >
                  {h.value ? <span className="truncate text-[13px]">{h.value}</span> : <NullValue />}
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
          {data && data.partial && (
            <p className="text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
              Search timed out before scanning all <strong>{data.scannedTables}</strong> eligible tables — results may
              be incomplete.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// /api/query runs raw SQL either against one relational connection in its
// own dialect ("single") or across several via an embedded DuckDB that
// ATTACHes each one read-only ("federated" — see lib/federation/duckdb.ts).
// Mongo and connections that failed to load aren't offered either way: only
// postgres/mysql can be ATTACHed by the federation engine, and "single"
// mirrors that same list for consistency.
function SqlTab({
  onRun,
  restore,
}: {
  onRun: (entry: SqlHistoryEntry) => void;
  restore: (SqlHistoryEntry & { nonce: number }) | null;
}) {
  const { data: catalog } = useCatalog();
  const connections = (catalog?.connections ?? []).filter(
    (c) => !c.error && (c.engine === "postgres" || c.engine === "mysql"),
  );

  const [mode, setMode] = useState<SqlMode>("single");
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [sql, setSql] = useState("");

  // Defaults to the first eligible connection once the catalog loads.
  const firstConnectionName = connections[0]?.connectionName;
  const defaulted = useRef(false);
  useEffect(() => {
    if (!defaulted.current && firstConnectionName) {
      setSelectedNames([firstConnectionName]);
      defaulted.current = true;
    }
  }, [firstConnectionName]);

  useEffect(() => {
    if (!restore) return;
    setMode(restore.mode);
    setSelectedNames(restore.connections);
    setSql(restore.text);
    defaulted.current = true; // a restored pick overrides the first-connection default
    // nonce alone identifies a restore event — the rest is read once from
    // the same object, not independent reactive deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore?.nonce]);

  // Single-connection mode: a chip click replaces the selection. Federated
  // mode: a chip click toggles that connection in/out of the attach set.
  const toggleConnection = (name: string) => {
    if (mode === "single") {
      setSelectedNames([name]);
    } else {
      setSelectedNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
    }
  };

  // collapse a multi-selection down to one when leaving federated mode
  const switchMode = (next: SqlMode) => {
    setMode(next);
    if (next === "single") setSelectedNames((prev) => prev.slice(0, 1));
  };

  const selected = connections.find((c) => c.connectionName === selectedNames[0]) ?? null;
  const canRun = mode === "single" ? !!selected : selectedNames.length > 0;

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!canRun || !sql.trim() || running) return;
    onRun({ type: "sql", text: sql, mode, connections: selectedNames });
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: mode,
          connections: selectedNames,
          sql,
          dialect: mode === "single" ? selected!.engine : "duckdb",
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setResult(null);
        setError(body.error ?? "Query failed");
      } else {
        setResult(body);
      }
    } catch (e) {
      setResult(null);
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Chip active={mode === "federated"} onClick={() => switchMode(mode === "federated" ? "single" : "federated")}>
              federate
            </Chip>
            {connections.map((c) => (
              <Chip
                key={c.connectionId}
                active={selectedNames.includes(c.connectionName)}
                onClick={() => toggleConnection(c.connectionName)}
              >
                {c.connectionName}
              </Chip>
            ))}
          </div>
          {mode === "federated" && (
            <p className="text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
              Each connection is attached under its own name — address tables as{" "}
              <code className="code">connection.schema.table</code>.
            </p>
          )}
          <SqlEditor
            value={sql}
            onChange={setSql}
            placeholder={mode === "federated" ? "select * from conn1.public.users u join conn2.public.orders o on …" : "select * from …"}
            minRows={3}
          />
          <Button size="sm" onClick={run} disabled={!canRun || !sql.trim() || running}>
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run
          </Button>
        </CardContent>
      </Card>
      {error && (
        <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
          {error}
        </p>
      )}
      {result && <ResultGrid result={result} maxHeight="65vh" />}
    </div>
  );
}

function HistoryList({ history, onSelect }: { history: HistoryEntry[]; onSelect: (entry: HistoryEntry) => void }) {
  if (history.length === 0) {
    return (
      <p className="text-[12.5px] py-6 text-center" style={{ color: "var(--muted-foreground-faint)" }}>
        Nothing run yet.
      </p>
    );
  }
  return (
    <div className="space-y-0.5">
      {history.map((entry) => (
        <button
          key={`${entry.type}|${entry.text}`}
          onClick={() => onSelect(entry)}
          className="w-full text-left rounded-md px-2 py-1.5 hoverable"
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            {entry.type === "search" ? (
              <Search className="size-3 shrink-0" style={{ color: "var(--muted-foreground-faint)" }} />
            ) : (
              <Play className="size-3 shrink-0" style={{ color: "var(--muted-foreground-faint)" }} />
            )}
            <span
              className="text-[10.5px] font-semibold uppercase tracking-wider truncate"
              style={{ color: "var(--muted-foreground-faint)" }}
            >
              {entry.type === "search"
                ? entry.connFilter === ALL_CONNECTIONS
                  ? "all connections"
                  : entry.connFilter
                : entry.mode === "federated"
                  ? `federated: ${entry.connections.join(", ")}`
                  : entry.connections[0]}
            </span>
          </div>
          <div className="code text-[12px] truncate">{entry.text}</div>
        </button>
      ))}
    </div>
  );
}

export default function ExplorePage() {
  const [tab, setTab] = useState<"search" | "sql">("search");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => setHistory(loadHistory()), []);

  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setHistoryOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const [restore, setRestore] = useState<{ entry: HistoryEntry; nonce: number } | null>(null);
  const restoreSearch =
    restore && restore.entry.type === "search" ? { ...restore.entry, nonce: restore.nonce } : null;
  const restoreSql = restore && restore.entry.type === "sql" ? { ...restore.entry, nonce: restore.nonce } : null;

  // Recorded on every submitted search / every executed SQL run — deduped by
  // (type, exact text), moving a repeat to the top instead of listing it twice.
  const recordHistory = (entry: SearchHistoryEntry | SqlHistoryEntry) => {
    setHistory((prev) => {
      const next = [
        { ...entry, ranAt: Date.now() } as HistoryEntry,
        ...prev.filter((e) => !(e.type === entry.type && e.text === entry.text)),
      ].slice(0, HISTORY_LIMIT);
      saveHistory(next);
      return next;
    });
  };

  const restoreEntry = (entry: HistoryEntry) => {
    setTab(entry.type);
    setRestore({ entry, nonce: Date.now() });
    setHistoryOpen(false);
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <Breadcrumbs className="mb-4" items={[{ label: "Home", link: "/" }, { label: "Explore" }]} />
          <h1 className="text-xl font-semibold">Explore</h1>
        </div>
        <Button variant="secondary" size="sm" className="gap-1.5 shrink-0" onClick={() => setHistoryOpen(true)}>
          <HistoryIcon className="size-3.5" />
          History
          <span className="text-[10px]" style={{ color: "var(--muted-foreground-faint)" }}>
            ⌘H
          </span>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "search" | "sql")}>
        <TabsList className="mb-4">
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="sql">SQL query</TabsTrigger>
        </TabsList>
        <TabsContent value="search">
          <SearchTab onRun={recordHistory} restore={restoreSearch} />
        </TabsContent>
        <TabsContent value="sql">
          <SqlTab onRun={recordHistory} restore={restoreSql} />
        </TabsContent>
      </Tabs>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="flex flex-col">
          <SheetHeader>
            <SheetTitle>History</SheetTitle>
            <SheetDescription>Every unique search or SQL query you&apos;ve run in Explore.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 pb-4">
            <HistoryList history={history} onSelect={restoreEntry} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
