"use client";

import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { MoreHorizontal, Search, X } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { useAuth } from "@/components/auth-context";
import { tableHref, customizeHref } from "@/components/browse/use-schema-param";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DataSelect } from "@/components/ui/data-select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar as SidebarShell,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useSchemaMeta } from "@/components/browse/useTableMeta";
import { resolveTableOverride } from "@/lib/introspect/overrides";
import { supportsSchemas, type CatalogResponse } from "@/lib/types";

const NAV = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/ai", label: "Ask AI", icon: "✦" },
  { href: "/dashboards", label: "Dashboards", icon: "▦" },
  { href: "/audit", label: "Audit log", icon: "≡" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

function loadedSchemasKey(conn: string) {
  return `lizard.schemas.${conn}`;
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  return (
    <Button
      variant="secondary"
      size="sm"
      style={{ padding: "2px 8px" }}
      title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    >
      {theme === "light" ? "🌙" : "☀️"}
    </Button>
  );
}

// Placeholder rows sized like the table links they stand in for, so the
// sidebar keeps its shape while a schema's tables load instead of collapsing
// to nothing (switching connection refetches, which used to blank the list).
//
// Skeleton's default `bg-muted` is all but identical to `--sidebar`, so it
// vanishes here — tint from the foreground instead, which stays legible in
// both themes.
function TableListSkeleton({ rows = 7 }: { rows?: number }) {
  const widths = [72, 54, 83, 61, 76, 48, 68, 58, 79, 52];
  return (
    <div className="px-2.5 py-1 space-y-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-3.5 bg-foreground/10" style={{ width: `${widths[i % widths.length]}%` }} />
      ))}
    </div>
  );
}

function SchemaSection({
  connectionId,
  connectionName,
  schemaName,
  includeSchemaInUrl,
  tableQ,
  showHidden,
  onToggleHidden,
  showDivider,
  pathname,
}: {
  connectionId: string;
  connectionName: string;
  schemaName: string;
  includeSchemaInUrl: boolean;
  tableQ: string;
  showHidden: boolean;
  onToggleHidden: (v: boolean) => void;
  showDivider: boolean;
  pathname: string;
}) {
  const { schemaMeta: schemaData, isLoading, error } = useSchemaMeta(connectionName, schemaName);

  if (error) {
    return (
      <div className="px-2.5 py-1 text-[12px]" style={{ color: "var(--destructive)" }}>
        {schemaName} — failed to load
      </div>
    );
  }
  // Only a genuinely pending fetch shows the skeleton. Once it settles, an
  // empty schema is an empty state — not a loader that never resolves.
  if (isLoading) {
    return (
      <div className="mb-1">
        {showDivider && <SidebarGroupLabel className="mt-2">{schemaName}</SidebarGroupLabel>}
        <TableListSkeleton />
      </div>
    );
  }
  if (!schemaData) return null;

  const allTables = schemaData.tables.map((t) => {
    const o = resolveTableOverride(schemaData.tableOverrides, connectionId, schemaName, t.name);
    return { name: t.name, label: o?.label || t.name, hidden: o?.hidden ?? false };
  });
  if (allTables.length === 0) {
    return (
      <div className="mb-1">
        {showDivider && <SidebarGroupLabel className="mt-2">{schemaName}</SidebarGroupLabel>}
        <p className="px-2.5 py-1 text-[12px]" style={{ color: "var(--muted-foreground-faint)" }}>
          No tables.
        </p>
      </div>
    );
  }

  const visibleTables = allTables
    .filter((t) => !t.hidden)
    .filter((t) => !tableQ || t.label.toLowerCase().includes(tableQ) || t.name.toLowerCase().includes(tableQ));
  const hiddenTables = allTables
    .filter((t) => t.hidden)
    .filter((t) => !tableQ || t.label.toLowerCase().includes(tableQ) || t.name.toLowerCase().includes(tableQ));
  // everything filtered out by the search box — the toolbar already says so
  if (visibleTables.length === 0 && hiddenTables.length === 0) return null;

  return (
    <div className="mb-1">
      {showDivider && <SidebarGroupLabel className="mt-2">{schemaName}</SidebarGroupLabel>}
      <SidebarMenu>
        {visibleTables.map((t) => {
          const path = `/browse/${connectionName}/${encodeURIComponent(t.name)}`;
          const urlSchema = includeSchemaInUrl ? schemaName : undefined;
          const href = tableHref({ connection: connectionName, schema: urlSchema, table: t.name });
          const active = pathname === path || pathname.startsWith(path + "/");
          return (
            <SidebarMenuItem key={t.name}>
              <SidebarMenuButton
                isActive={active}
                render={<Link href={href} title={t.label !== t.name ? t.name : undefined} />}
              >
                {t.label}
              </SidebarMenuButton>
              <DropdownMenu>
                <DropdownMenuTrigger render={<SidebarMenuAction showOnHover />}>
                  <MoreHorizontal />
                  <span className="sr-only">{t.label} actions</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuItem
                    render={
                      <Link href={customizeHref({ connection: connectionName, schema: urlSchema, table: t.name })} />
                    }
                  >
                    ⚙ Customize
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
      {hiddenTables.length > 0 && !showHidden && (
        <Button
          variant="ghost"
          className="flex items-center gap-1 px-2.5 py-1 text-[12px] w-full text-left rounded hoverable"
          style={{ color: "var(--muted-foreground-faint)" }}
          onClick={() => onToggleHidden(true)}
        >
          <span>⊘</span>
          <span>{hiddenTables.length} hidden</span>
        </Button>
      )}
      {showHidden &&
        hiddenTables.map((t) => {
          const path = `/browse/${connectionName}/${encodeURIComponent(t.name)}`;
          const href = tableHref({
            connection: connectionName,
            schema: includeSchemaInUrl ? schemaName : undefined,
            table: t.name,
          });
          const active = pathname === path || pathname.startsWith(path + "/");
          return (
            <Link
              key={t.name}
              href={href}
              title={`${t.label !== t.name ? t.name + " · " : ""}hidden — open to customize`}
              className="block rounded px-2.5 py-1 text-[14px] truncate line-through"
              style={{
                color: "var(--muted-foreground-faint)",
                background: active ? "var(--sidebar-accent)" : undefined,
              }}
            >
              {t.label}
            </Link>
          );
        })}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ connection?: string; schema?: string }>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useQuery<CatalogResponse>({
    queryKey: ["catalog"],
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error("failed to load catalog");
      return res.json();
    },
  });

  const connections = useMemo(() => data?.connections ?? [], [data]);
  const [selected, setSelected] = useState<string>("");
  const [loaded, setLoaded] = useState<string[]>([]);
  const [addingSchema, setAddingSchema] = useState(false);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  // Schema filter chip, remembered per connection in memory (the sidebar
  // never unmounts across navigation, so no localStorage needed) — switching
  // databases restores that database's own filter instead of leaking the
  // previous one or losing it.
  const [activeSchemaByConn, setActiveSchemaByConn] = useState<Record<string, string | null>>({});

  // follow the URL when browsing; otherwise keep/first connection
  useEffect(() => {
    if (params.connection) {
      if (params.connection !== selected) {
        setSelected(params.connection);
        setShowHidden(false);
      }
    } else if (connections.length > 0) {
      setSelected(connections[0].connectionName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.connection, connections]);

  const conn = connections.find((c) => c.connectionName === selected);
  const allSchemas = useMemo(() => conn?.schemas.map((s) => s.name) ?? [], [conn]);

  // restore loaded schemas per connection (default: first schema, or the one in the URL)
  useEffect(() => {
    if (!selected || allSchemas.length === 0) return;
    let stored: string[] = [];
    try {
      stored = JSON.parse(localStorage.getItem(loadedSchemasKey(selected)) ?? "[]");
    } catch {
      /* ignore */
    }
    let next = stored.filter((s) => allSchemas.includes(s));
    if (params.schema && allSchemas.includes(params.schema) && !next.includes(params.schema)) {
      next = [...next, params.schema];
    }
    if (next.length === 0) next = [allSchemas.includes("public") ? "public" : allSchemas[0]];
    setLoaded(next);
    setAddingSchema(false);
    setSchemaSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, allSchemas.join(","), params.schema]);

  // fall back to null if the remembered filter no longer matches a loaded
  // schema (e.g. it was just removed, or the schema list changed underneath).
  const activeSchemaRaw = activeSchemaByConn[selected] ?? null;
  const activeSchema = activeSchemaRaw && loaded.includes(activeSchemaRaw) ? activeSchemaRaw : null;
  const setActiveSchema = (next: string | null) => setActiveSchemaByConn((m) => ({ ...m, [selected]: next }));

  const persist = (next: string[], removedSchema?: string) => {
    setLoaded(next);
    if (removedSchema && activeSchema === removedSchema) setActiveSchema(null);
    try {
      localStorage.setItem(loadedSchemasKey(selected), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const remaining = allSchemas.filter((s) => !loaded.includes(s));

  // Guard against the render where `selected` has moved to a new connection but
  // the effect restoring `loaded` hasn't run yet: only schemas the current
  // connection actually has are safe to fetch.
  const shownSchemas = loaded
    .filter((s) => allSchemas.includes(s))
    .filter((s) => !activeSchema || s === activeSchema);

  const tableQ = tableSearch.trim().toLowerCase();

  return (
    <SidebarShell collapsible="none" className="border-r">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-2">
          <Link href="/" className="flex items-center gap-2 min-w-0">
            <span className="text-xl">🦎</span>
            <span className="font-semibold tracking-tight">Lizard</span>
          </Link>
          <span className="flex-1" />
          <ThemeToggle />
        </div>
      </SidebarHeader>

      <SidebarContent className="overflow-hidden">
        {/* nav */}
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton isActive={active} render={<Link href={item.href} />}>
                    <span className="w-4 text-center">{item.icon}</span>
                    {item.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator />

        {/* database selector */}
        <SidebarGroup>
          <SidebarGroupLabel>Database</SidebarGroupLabel>
          {connections.length === 0 ? (
            <p className="text-[12px] py-1 px-2" style={{ color: "var(--muted-foreground-faint)" }}>
              No connections yet
            </p>
          ) : (
            <DataSelect
              key={`${selected}-${connections.length}`}
              items={connections}
              value={connections.find((c) => c.connectionName === selected) ?? null}
              onChange={(c) => {
                if (c) {
                  setSelected(c.connectionName);
                  router.push(`/browse/${c.connectionName}`);
                }
              }}
              getValue={(c) => c.connectionName}
              getLabel={(c) => (
                <>
                  {c.connectionName}
                  {c.error ? " ⚠" : ""}
                </>
              )}
              className="w-full"
            />
          )}
          {conn?.error && (
            <p className="text-[11.5px] mt-1 px-2" style={{ color: "var(--destructive)" }} title={conn.error}>
              connection error
            </p>
          )}
        </SidebarGroup>

        {/* schema selector */}
        {conn && !conn.error && conn.engine === "postgres" && (
          <SidebarGroup>
            <div className="flex items-center justify-between mb-1">
              <SidebarGroupLabel>Schemas</SidebarGroupLabel>
              {remaining.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  style={{ padding: "0 7px" }}
                  title="Load another schema"
                  onClick={() => setAddingSchema((s) => !s)}
                >
                  ＋
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 px-2">
              {loaded.map((s) => {
                const isActive = activeSchema === s;
                return (
                  <Chip
                    key={s}
                    active={isActive}
                    title={isActive ? `Showing only ${s} — click to show all` : `Filter to ${s}`}
                    onClick={() => setActiveSchema(isActive ? null : s)}
                    onRemove={
                      loaded.length > 1
                        ? () =>
                            persist(
                              loaded.filter((x) => x !== s),
                              s,
                            )
                        : undefined
                    }
                    removeLabel={`Remove ${s}`}
                  >
                    {s}
                  </Chip>
                );
              })}
            </div>
            {addingSchema && (
              <div className="mt-1.5 px-2">
                <InputGroup className="h-8 mb-1 shadow-none">
                  <InputGroupAddon align="inline-start">
                    <Search className="size-3.5" />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder={`Search ${remaining.length} schemas…`}
                    value={schemaSearch}
                    autoFocus
                    onChange={(e) => setSchemaSearch(e.target.value)}
                  />
                  {schemaSearch && (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        title="Clear"
                        aria-label="Clear"
                        onClick={() => setSchemaSearch("")}
                      >
                        <X />
                      </InputGroupButton>
                    </InputGroupAddon>
                  )}
                </InputGroup>
                <div className="space-y-0.5 max-h-56 overflow-y-auto scrollbar-thin">
                  {(() => {
                    const q = schemaSearch.trim().toLowerCase();
                    const matches = q ? remaining.filter((s) => s.toLowerCase().includes(q)) : remaining;
                    return (
                      <>
                        {matches.slice(0, 50).map((s) => (
                          <Button
                            variant="ghost"
                            className="block w-full text-left rounded px-2 py-1 text-[13px] hoverable truncate"
                            key={s}
                            style={{ color: "var(--muted-foreground)" }}
                            onClick={() => {
                              persist([...loaded, s]);
                              setAddingSchema(false);
                              setSchemaSearch("");
                            }}
                          >
                            ＋ {s}
                          </Button>
                        ))}
                        {matches.length > 50 && (
                          <p className="px-2 py-1 text-[11.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
                            …{matches.length - 50} more — keep typing to narrow
                          </p>
                        )}
                        {matches.length === 0 && (
                          <p className="px-2 py-1 text-[11.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
                            No schemas match
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </SidebarGroup>
        )}

        {/* table filter */}
        {conn && !conn.error && loaded.length > 0 && (
          <div className="px-2 pb-1">
            <InputGroup className="h-8 shadow-none">
              <InputGroupAddon align="inline-start">
                <Search className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Filter tables…"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
              />
              {tableSearch && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    title="Clear filter"
                    aria-label="Clear filter"
                    onClick={() => setTableSearch("")}
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          </div>
        )}

        {/* tables of loaded schemas — the one scrollable region; everything
            above (nav, database, schema selector, filter) stays fixed */}
        <SidebarGroup className="flex-1 min-h-0 pt-0 overflow-y-auto scrollbar-thin">
          {/* Introspection drops schemas that hold no tables, so a connection can
              legitimately have none — that is an empty state, not a pending one.
              Only `loaded` lagging behind a connection switch means "still
              settling", and that is what the skeleton is for. */}
          {conn && !conn.error && allSchemas.length === 0 && (
            <p className="px-2.5 py-2 text-[12px]" style={{ color: "var(--muted-foreground-faint)" }}>
              No tables in this database.
            </p>
          )}
          {conn && !conn.error && allSchemas.length > 0 && shownSchemas.length === 0 && <TableListSkeleton />}
          {conn &&
            !conn.error &&
            shownSchemas.map((schemaName) => (
              <SchemaSection
                key={schemaName}
                connectionId={conn.connectionId}
                connectionName={conn.connectionName}
                schemaName={schemaName}
                includeSchemaInUrl={supportsSchemas(conn.engine)}
                tableQ={tableQ}
                showHidden={showHidden}
                onToggleHidden={setShowHidden}
                showDivider={shownSchemas.length > 1}
                pathname={pathname}
              />
            ))}
          {showHidden && conn && !conn.error && (
            <Button
              variant="ghost"
              className="flex items-center gap-1 mx-2.5 mt-1 mb-2 text-[12px] hoverable px-1 rounded"
              style={{ color: "var(--muted-foreground-faint)" }}
              onClick={() => setShowHidden(false)}
            >
              <span>⊘</span> hide hidden
            </Button>
          )}
          {conn && !conn.error && tableQ && (
            <p className="px-2.5 pt-1 text-[11.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
              filtering by "{tableSearch}"
            </p>
          )}
        </SidebarGroup>
      </SidebarContent>

      {/* user footer */}
      <SidebarFooter className="border-t">
        <div className="flex items-center gap-2 px-1 py-1">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium truncate" style={{ color: "var(--foreground)" }}>
              {user?.name || user?.email}
            </p>
            <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground-faint)" }}>
              {user?.role}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            title="Profile"
            nativeButton={false}
            render={<Link href="/profile" />}
          >
            ✎
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            title="Sign out"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              qc.clear();
              router.replace("/login");
            }}
          >
            ⏻
          </Button>
        </div>
      </SidebarFooter>
    </SidebarShell>
  );
}
