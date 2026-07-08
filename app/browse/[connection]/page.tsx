"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useCatalog } from "@/components/browse/useTableMeta";
import type { TableInfo } from "@/lib/types";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { tableHref } from "@/components/browse/use-schema-param";

function TableCard({ connection, schema, table }: { connection: string; schema: string; table: TableInfo }) {
  const href = tableHref(connection, schema, table.name);
  return (
    <div className="panel relative group flex text-[13px] font-medium overflow-hidden">
      <Link href={href} className="flex-1 px-4 py-3 min-w-0 pr-8">
        <div className="truncate">
          {table.name}
          {table.kind === "view" && (
            <span className="ml-1.5 text-[10px] font-normal" style={{ color: "var(--warning)" }}>
              view
            </span>
          )}
        </div>
        {table.rowEstimate > 0 && (
          <div className="text-[11px] font-normal mt-0.5" style={{ color: "var(--muted-foreground-faint)" }}>
            ~{table.rowEstimate.toLocaleString()} rows
          </div>
        )}
      </Link>
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" />}>⋯</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem render={<Link href={href} />}>Open table</DropdownMenuItem>
            <DropdownMenuItem render={<a href={href} target="_blank" rel="noreferrer" />}>
              Open in new tab
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function ConnectionPage() {
  const { connection } = useParams<{ connection: string }>();
  const { data: catalog, isLoading, error } = useCatalog();
  const [search, setSearch] = useState("");

  const conn = useMemo(() => catalog?.connections.find((c) => c.connectionName === connection), [catalog, connection]);

  const totalTables = useMemo(() => conn?.schemas.reduce((n, s) => n + s.tables.length, 0) ?? 0, [conn]);

  if (isLoading) return <PagePad>Loading…</PagePad>;
  if (error) return <PagePad style={{ color: "var(--destructive)" }}>Failed to load catalog.</PagePad>;
  if (!conn) return <PagePad>Connection &quot;{connection}&quot; not found.</PagePad>;

  const q = search.trim().toLowerCase();
  const sortedSchemas = conn.schemas.slice().sort((a, b) => a.name.localeCompare(b.name));
  const multiSchema = sortedSchemas.length > 1;

  return (
    <div className="px-8 py-8 max-w-5xl">
      <Breadcrumb className="mb-5">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{conn.connectionName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="text-xl font-semibold mb-1">{conn.connectionName}</h1>
      <p className="text-[13px] mb-4" style={{ color: "var(--muted-foreground)" }}>
        {conn.database} · {conn.schemas.length} schema{conn.schemas.length !== 1 ? "s" : ""} · {totalTables} table
        {totalTables !== 1 ? "s" : ""}
      </p>

      {conn.error && (
        <p
          className="text-[13px] mb-4 px-3 py-2 rounded-md border"
          style={{ color: "var(--destructive)", borderColor: "rgba(229,83,75,.4)" }}
        >
          {conn.error}
        </p>
      )}

      <input
        className="input mb-4"
        style={{ maxWidth: 320 }}
        placeholder="Search tables…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />

      {sortedSchemas.map((schema) => {
        const tables = schema.tables
          .filter((t) => !q || t.name.toLowerCase().includes(q))
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
        if (tables.length === 0) return null;
        return (
          <div key={schema.name} className="mb-6">
            {multiSchema && (
              <div className="text-[12px] font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--muted-foreground-faint)" }}>
                {schema.name}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {tables.map((t) => (
                <TableCard key={t.name} connection={connection} schema={schema.name} table={t} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PagePad({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="px-8 py-10 text-[14px]" style={{ color: "var(--muted-foreground)", ...style }}>
      {children}
    </div>
  );
}
