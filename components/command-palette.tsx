"use client";

// ⌘K "Go to" navigation palette. Jumps to a table, connection, dashboard, or
// page — it does NOT search row content (that's Explore / ⌘E). Grammar:
//
//   orders            global: tables + connections + dashboards + pages
//   prod/             everything in connections starting "prod"
//   prod/ord          tables ~ord in prod
//   prod/public/ord   schema public, table ~ord, in prod
//   dash/rev          dashboards ~rev
//
// The first segment before a "/" is a scope: a reserved category word
// (dashboards/connections/settings, matched by startsWith so `dash/` works)
// wins, otherwise it's a connection-name prefix. Connections, dashboards and
// pages are filtered client-side from already-cached data; tables come from
// /api/search (name-only, server-side) because the client only holds the
// active connection's loaded schemas — the "/" scope is what loads the rest.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, Table2, Database, LayoutDashboard, Settings as SettingsIcon, Compass } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useCatalog } from "@/components/browse/use-catalog";
import { useDashboards } from "@/components/charts/use-dashboards";
import { tableHref } from "@/components/browse/use-schema-param";
import type { TableSearchResult } from "@/lib/data/table-search";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

interface Item {
  key: string;
  href: string;
  label: string;
  sub?: string;
  icon: ReactNode;
  badge?: string;
}
interface Section {
  title: string;
  items: Item[];
}

// Reserved scope words win the first segment over a connection prefix, matched
// by startsWith so a partial (`dash`, `set`) still resolves. These are unlikely
// to also be connection names; a genuine collision just shows both groups.
const RESERVED = ["dashboards", "connections", "settings"] as const;
type Reserved = (typeof RESERVED)[number];

const PAGES: { label: string; href: string; icon: ReactNode; keywords: string[] }[] = [
  {
    label: "Explore",
    href: "/explore",
    icon: <Compass className="size-3.5" />,
    keywords: ["explore", "search", "sql", "query", "rows"],
  },
  {
    label: "Dashboards",
    href: "/dashboards",
    icon: <LayoutDashboard className="size-3.5" />,
    keywords: ["dashboards", "charts"],
  },
  {
    label: "Settings",
    href: "/settings",
    icon: <SettingsIcon className="size-3.5" />,
    keywords: ["settings", "connections", "users", "audit"],
  },
];

const MAX_PER_SECTION = 8;

type Parsed =
  | { kind: "global"; text: string }
  | { kind: "category"; category: Reserved; text: string }
  | { kind: "connection"; connectionPrefix: string; schema?: string; tableText: string };

function parseQuery(raw: string): Parsed {
  const value = raw.trim();
  if (!value.includes("/")) return { kind: "global", text: value };
  const segs = value.split("/").map((s) => s.trim());
  const scope = segs[0].toLowerCase();
  const cat = scope.length > 0 ? RESERVED.find((r) => r.startsWith(scope)) : undefined;
  if (cat) return { kind: "category", category: cat, text: segs.slice(1).join("/").trim() };
  // conn/table  → schema undefined;  conn/schema/table → middle is the schema.
  if (segs.length >= 3) {
    return {
      kind: "connection",
      connectionPrefix: segs[0],
      schema: segs[1] || undefined,
      tableText: segs.slice(2).join("/"),
    };
  }
  return { kind: "connection", connectionPrefix: segs[0], tableText: segs[1] ?? "" };
}

function includesCI(haystack: string, needle: string): boolean {
  return !needle || haystack.toLowerCase().includes(needle.toLowerCase());
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const debounced = useDebounced(raw, 250);
  const parsed = useMemo(() => parseQuery(debounced), [debounced]);

  const { data: catalog } = useCatalog();
  const { data: dashboards } = useDashboards({ enabled: open });
  const connections = useMemo(
    () => (catalog?.connections ?? []).filter((c) => !(c as { error?: string }).error),
    [catalog],
  );

  // Fresh input every time the palette opens, so a previous query doesn't linger.
  useEffect(() => {
    if (open) setRaw("");
  }, [open]);

  // Only these two shapes hit the (server-side) table endpoint; categories
  // never do. Null = don't fetch.
  const tableParams = useMemo<{ q: string; connection: string; schema: string } | null>(() => {
    if (parsed.kind === "global") {
      return parsed.text.trim().length >= 2 ? { q: parsed.text.trim(), connection: "", schema: "" } : null;
    }
    if (parsed.kind === "connection") {
      return parsed.connectionPrefix.trim().length >= 1
        ? {
            q: parsed.tableText.trim(),
            connection: parsed.connectionPrefix.trim(),
            schema: parsed.schema?.trim() ?? "",
          }
        : null;
    }
    return null;
  }, [parsed]);

  const { data: tableData, isFetching: tablesFetching } = useQuery<TableSearchResult>({
    queryKey: ["table-search", tableParams],
    queryFn: async ({ signal }) => {
      const p = new URLSearchParams();
      if (tableParams!.q) p.set("q", tableParams!.q);
      if (tableParams!.connection) p.set("connection", tableParams!.connection);
      if (tableParams!.schema) p.set("schema", tableParams!.schema);
      const res = await fetch(`/api/search?${p.toString()}`, { signal });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: open && !!tableParams,
    staleTime: 30_000,
  });

  const tableItems = useMemo<Item[]>(
    () =>
      (tableData?.hits ?? []).map((h) => ({
        key: `t-${h.connection}-${h.schema ?? ""}-${h.table}`,
        href: tableHref({ connection: h.connection, schema: h.schema, table: h.table }),
        label: h.label,
        sub: `${h.connection}${h.schema ? ` · ${h.schema}` : ""}`,
        icon: <Table2 className="size-3.5" />,
        badge: h.isView ? "view" : undefined,
      })),
    [tableData],
  );

  const connectionItems = (match: (name: string) => boolean, cap = MAX_PER_SECTION): Item[] =>
    connections
      .filter((c) => match(c.connectionName))
      .slice(0, cap)
      .map((c) => ({
        key: `c-${c.connectionId}`,
        href: `/browse/${c.connectionName}`,
        label: c.connectionName,
        sub: c.engine,
        icon: <Database className="size-3.5" />,
      }));

  const dashboardItems = (match: (name: string) => boolean, cap = MAX_PER_SECTION): Item[] =>
    (dashboards ?? [])
      .filter((d) => match(d.name))
      .slice(0, cap)
      .map((d) => ({
        key: `d-${d.id}`,
        href: `/dashboards/${d.id}`,
        label: d.name,
        sub: "Dashboard",
        icon: <LayoutDashboard className="size-3.5" />,
      }));

  const pageItems = (text: string): Item[] =>
    PAGES.filter((p) => includesCI(p.label, text) || p.keywords.some((k) => k.includes(text.toLowerCase()))).map(
      (p) => ({
        key: `p-${p.href}`,
        href: p.href,
        label: p.label,
        icon: p.icon,
      }),
    );

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    const push = (title: string, items: Item[]) => {
      if (items.length) out.push({ title, items });
    };

    if (parsed.kind === "category") {
      const t = parsed.text;
      if (parsed.category === "dashboards")
        push(
          "Dashboards",
          dashboardItems((n) => includesCI(n, t), 50),
        );
      else if (parsed.category === "connections")
        push(
          "Connections",
          connectionItems((n) => includesCI(n, t), 50),
        );
      else push("Settings", pageItems("settings"));
      return out;
    }

    if (parsed.kind === "connection") {
      const pfx = parsed.connectionPrefix;
      // the connection landing page itself, plus its tables
      push(
        "Databases",
        connectionItems((n) => n.toLowerCase().startsWith(pfx.toLowerCase())),
      );
      push("Tables", tableItems);
      return out;
    }

    // global
    const t = parsed.text;
    push("Tables", tableItems);
    push(
      "Connections",
      connectionItems((n) => includesCI(n, t)),
    );
    push(
      "Dashboards",
      dashboardItems((n) => includesCI(n, t)),
    );
    push("Pages", pageItems(t));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, tableItems, connections, dashboards]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const [selected, setSelected] = useState(0);
  // Any change to the result set re-anchors selection to the top.
  useEffect(() => setSelected(0), [debounced, flat.length]);

  const navigate = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const anyLoading = tablesFetching;
  const hasQuery = debounced.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col gap-3 p-3 sm:max-w-none"
        style={{ width: 560, maxWidth: "92vw", maxHeight: "70vh" }}
      >
        <DialogTitle className="sr-only">Go to</DialogTitle>
        <InputGroup className="shrink-0">
          <InputGroupAddon align="inline-start">
            {anyLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            placeholder="Go to table, connection, dashboard…   (conn/table · dash/name)"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((i) => Math.min(flat.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = flat[selected];
                if (item) navigate(item.href);
              }
            }}
          />
        </InputGroup>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {!hasQuery && (
            <p className="px-2 py-6 text-center text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
              Search tables, connections, and dashboards. Scope with <span className="code">conn/table</span> or{" "}
              <span className="code">dash/name</span>.
            </p>
          )}
          {hasQuery && flat.length === 0 && !anyLoading && (
            <p className="px-2 py-6 text-center text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
              No matches.
            </p>
          )}
          {sections.map((section) => {
            // running offset so each item's flat index (for selection) is stable
            const start = flat.findIndex((f) => f.key === section.items[0].key);
            return (
              <div key={section.title} className="mb-2">
                <div
                  className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--muted-foreground-faint)" }}
                >
                  {section.title}
                </div>
                {section.items.map((item, i) => {
                  const index = start + i;
                  const isSelected = index === selected;
                  return (
                    <button
                      key={item.key}
                      ref={isSelected ? selectedRef : undefined}
                      onMouseMove={() => setSelected(index)}
                      onClick={() => navigate(item.href)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
                      style={{ background: isSelected ? "var(--sidebar-accent)" : undefined }}
                    >
                      <span className="shrink-0" style={{ color: "var(--muted-foreground-faint)" }}>
                        {item.icon}
                      </span>
                      <span className="truncate text-[13px]">{item.label}</span>
                      {item.badge && (
                        <span
                          className="shrink-0 rounded px-1 text-[9.5px] uppercase tracking-wide"
                          style={{ background: "var(--muted)", color: "var(--muted-foreground-faint)" }}
                        >
                          {item.badge}
                        </span>
                      )}
                      {item.sub && (
                        <span
                          className="code ml-auto shrink-0 truncate max-w-48"
                          style={{ fontSize: 10.5, color: "var(--muted-foreground-faint)" }}
                        >
                          {item.sub}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}

// Owns the ⌘K palette's open state and the shortcut, so every trigger (the
// top-right search box, the keyboard shortcut, anything else) drives one shared
// instance. Mounted once, high in the tree — see components/app-shell.tsx.
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const value = useMemo<CommandPaletteContextValue>(
    () => ({ open, setOpen, toggle: () => setOpen((o) => !o) }),
    [open],
  );
  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </CommandPaletteContext.Provider>
  );
}

// A placeholder search box that opens the palette on click — not a real input,
// just the affordance. Positioning (e.g. absolute, top-right of the breadcrumb
// row) is left to the caller via className/style.
export function CommandPaletteTrigger({ className, style }: { className?: string; style?: CSSProperties }) {
  const { setOpen } = useCommandPalette();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Search (⌘K)"
      className={`flex h-8 min-w-50 items-center gap-2 rounded-md border px-2.5 text-[13px] transition-colors hoverable ${className ?? ""}`}
      style={{
        borderColor: "var(--border)",
        background: "var(--card)",
        color: "var(--muted-foreground-faint)",
        ...style,
      }}
    >
      <Search className="size-3.5 shrink-0" />
      <span>Search…</span>
      <kbd
        className="ml-auto rounded px-1 text-[10px]"
        style={{ background: "var(--muted)", color: "var(--muted-foreground-faint)" }}
      >
        ⌘K
      </kbd>
    </button>
  );
}
