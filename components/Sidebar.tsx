"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme, toggleTheme } from "@/components/useTheme";

interface CatalogTable {
  name: string;
}
interface CatalogSchema {
  name: string;
  tables: CatalogTable[];
}
interface CatalogConnection {
  connectionId: string;
  connectionName: string;
  database: string;
  schemas: CatalogSchema[];
  error?: string;
}
interface TableOverride {
  connectionId: string;
  schema: string;
  table: string;
  hidden: boolean;
  label: string | null;
}
interface CatalogResponse {
  connections: CatalogConnection[];
  tableOverrides: TableOverride[];
}

const NAV = [
  { href: "/", label: "Connections", icon: "◆" },
  { href: "/ai", label: "Ask AI", icon: "✦" },
  { href: "/dashboards", label: "Dashboards", icon: "▦" },
  { href: "/audit", label: "Audit log", icon: "≡" },
];

function loadedSchemasKey(conn: string) {
  return `lizard.schemas.${conn}`;
}

function ThemeToggle() {
  const theme = useTheme();
  return (
    <button
      className="btn btn-sm"
      style={{ padding: "2px 8px" }}
      title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      onClick={toggleTheme}
    >
      {theme === "light" ? "🌙" : "☀️"}
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ connection?: string; schema?: string }>();
  const { data } = useQuery<CatalogResponse>({
    queryKey: ["catalog"],
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error("failed to load catalog");
      return res.json();
    },
  });

  const connections = useMemo(() => data?.connections ?? [], [data]);
  const overrides = useMemo(() => data?.tableOverrides ?? [], [data]);
  const [selected, setSelected] = useState<string>("");
  const [loaded, setLoaded] = useState<string[]>([]);
  const [addingSchema, setAddingSchema] = useState(false);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");

  // follow the URL when browsing; otherwise keep/first connection
  useEffect(() => {
    if (params.connection && params.connection !== selected) {
      setSelected(params.connection);
    } else if (!selected && connections.length > 0) {
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

  const persist = (next: string[]) => {
    setLoaded(next);
    try {
      localStorage.setItem(loadedSchemasKey(selected), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const remaining = allSchemas.filter((s) => !loaded.includes(s));

  // override lookup: connectionId.schema.table → { hidden, label }
  const overrideFor = (schema: string, table: string) =>
    overrides.find((o) => o.connectionId === conn?.connectionId && o.schema === schema && o.table === table);

  const tableQ = tableSearch.trim().toLowerCase();

  return (
    <aside
      className="w-60 shrink-0 flex flex-col border-r overflow-y-auto scrollbar-thin"
      style={{ background: "var(--bg-panel)" }}
    >
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <Link href="/" className="flex items-center gap-2 min-w-0">
          <span className="text-xl">🦎</span>
          <span className="font-semibold tracking-tight">Lizard</span>
        </Link>
        <span className="flex-1" />
        <ThemeToggle />
      </div>

      <nav className="px-2 py-3 space-y-0.5 border-b">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[14px] font-medium transition-colors"
              style={{
                background: active ? "var(--accent-soft)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-dim)",
              }}
            >
              <span className="w-4 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* database selector */}
      <div className="px-3 pt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Database
          </span>
          <Link href="/" className="btn btn-sm" title="Add another database connection" style={{ padding: "0 7px" }}>
            ＋
          </Link>
        </div>
        {connections.length === 0 ? (
          <p className="text-[12px] py-1" style={{ color: "var(--text-faint)" }}>
            No connections yet
          </p>
        ) : (
          <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {connections.map((c) => (
              <option key={c.connectionName} value={c.connectionName}>
                {c.connectionName}
                {c.error ? " ⚠" : ""}
              </option>
            ))}
          </select>
        )}
        {conn?.error && (
          <p className="text-[11.5px] mt-1" style={{ color: "var(--red)" }} title={conn.error}>
            connection error
          </p>
        )}
      </div>

      {/* schema selector */}
      {conn && !conn.error && (
        <div className="px-3 pt-4 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
              Schemas
            </span>
            {remaining.length > 0 && (
              <button
                className="btn btn-sm"
                style={{ padding: "0 7px" }}
                title="Load another schema"
                onClick={() => setAddingSchema((s) => !s)}
              >
                ＋
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {loaded.map((s) => (
              <span key={s} className="tag" style={{ color: "var(--text)" }}>
                {s}
                {loaded.length > 1 && (
                  <button
                    className="ml-1.5"
                    style={{ color: "var(--text-faint)" }}
                    onClick={() => persist(loaded.filter((x) => x !== s))}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
          {addingSchema && (
            <div className="mt-1.5">
              <input
                className="input mb-1"
                style={{ padding: "4px 8px", fontSize: 12 }}
                placeholder={`Search ${remaining.length} schemas…`}
                value={schemaSearch}
                autoFocus
                onChange={(e) => setSchemaSearch(e.target.value)}
              />
              <div className="space-y-0.5 max-h-56 overflow-y-auto scrollbar-thin">
                {(() => {
                  const q = schemaSearch.trim().toLowerCase();
                  const matches = q ? remaining.filter((s) => s.toLowerCase().includes(q)) : remaining;
                  return (
                    <>
                      {matches.slice(0, 50).map((s) => (
                        <button
                          key={s}
                          className="block w-full text-left rounded px-2 py-1 text-[13px] hoverable truncate"
                          style={{ color: "var(--text-dim)" }}
                          onClick={() => {
                            persist([...loaded, s]);
                            setAddingSchema(false);
                            setSchemaSearch("");
                          }}
                        >
                          ＋ {s}
                        </button>
                      ))}
                      {matches.length > 50 && (
                        <p className="px-2 py-1 text-[11.5px]" style={{ color: "var(--text-faint)" }}>
                          …{matches.length - 50} more — keep typing to narrow
                        </p>
                      )}
                      {matches.length === 0 && (
                        <p className="px-2 py-1 text-[11.5px]" style={{ color: "var(--text-faint)" }}>
                          No schemas match
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* table filter */}
      {conn && !conn.error && loaded.length > 0 && (
        <div className="px-3 pb-1">
          <input
            className="input"
            style={{ padding: "4px 8px", fontSize: 12 }}
            placeholder="Filter tables…"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
          />
        </div>
      )}

      {/* tables of loaded schemas */}
      <div className="px-2 pb-4 flex-1">
        {conn &&
          !conn.error &&
          loaded.map((schemaName) => {
            const schema = conn.schemas.find((s) => s.name === schemaName);
            if (!schema) return null;
            // hidden-override tables drop out; label override drives display + search
            const tables = schema.tables
              .map((t) => {
                const o = overrideFor(schemaName, t.name);
                return { name: t.name, label: o?.label || t.name, hidden: o?.hidden ?? false };
              })
              .filter((t) => !t.hidden)
              .filter((t) => !tableQ || t.label.toLowerCase().includes(tableQ) || t.name.toLowerCase().includes(tableQ));
            if (tables.length === 0) return null;
            return (
              <div key={schemaName} className="mb-2">
                {loaded.length > 1 && (
                  <div className="px-2.5 pt-2 pb-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
                    {schemaName}
                  </div>
                )}
                {tables.map((t) => {
                  const href = `/browse/${conn.connectionName}/${schemaName}/${t.name}`;
                  const active = pathname === href || pathname.startsWith(href + "/");
                  return (
                    <Link
                      key={t.name}
                      href={href}
                      title={t.label !== t.name ? t.name : undefined}
                      className="block rounded px-2.5 py-1 text-[14px] truncate"
                      style={{
                        background: active ? "var(--accent-soft)" : "transparent",
                        color: active ? "var(--accent)" : "var(--text-dim)",
                      }}
                    >
                      {t.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        {conn && !conn.error && tableQ && (
          <p className="px-2.5 pt-1 text-[11.5px]" style={{ color: "var(--text-faint)" }}>
            filtering by “{tableSearch}”
          </p>
        )}
      </div>
    </aside>
  );
}
