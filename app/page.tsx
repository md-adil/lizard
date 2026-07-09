"use client";

import Link from "next/link";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { useCatalog } from "@/components/browse/useTableMeta";
import { EngineIcon, ENGINE_LABELS } from "@/components/engine-icon";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supportsSchemas, type LightConnectionCatalog } from "@/lib/types";
import { pluralize } from "@/lib/pluralize";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const QUICK_LINKS = [
  { href: "/ai", icon: "✦", label: "Ask AI", desc: "Query in plain English" },
  {
    href: "/dashboards",
    icon: "▦",
    label: "Dashboards",
    desc: "Saved charts across databases",
  },
  {
    href: "/audit",
    icon: "≡",
    label: "Audit log",
    desc: "Every query and write",
  },
  {
    href: "/settings",
    icon: "⚙",
    label: "Settings",
    desc: "Connections and users",
  },
];

export default function HomePage() {
  const { user } = useAuth();
  const { data: catalog, isLoading } = useCatalog();
  const connections = catalog?.connections ?? [];

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-3xl select-none">🦎</span>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting()}
          {user?.name ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
      </div>
      <p className="text-[14.5px] mb-8" style={{ color: "var(--muted-foreground)" }}>
        Your Postgres fleet, browsable, editable, and queryable — without writing a line of SQL.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {QUICK_LINKS.map((q) => (
          <Link key={q.href} href={q.href} className="block">
            <Card className="p-0 hover:bg-accent/40 transition-colors">
              <div className="px-4 py-4">
                <span className="text-xl leading-none">{q.icon}</span>
                <div className="text-[13px] font-medium mt-2">{q.label}</div>
                <div className="text-[11.5px] mt-0.5" style={{ color: "var(--muted-foreground-faint)" }}>
                  {q.desc}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-[13px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted-foreground-faint)" }}
        >
          Your databases
        </h2>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/settings" />}>
          Manage connections
        </Button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className="p-0">
              <div className="px-5 py-4 flex items-start gap-3">
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-5 w-16 rounded-4xl" />
                  </div>
                  <Skeleton className="h-3 w-40 mt-2" />
                  <Skeleton className="h-2.5 w-20 mt-3" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && connections.length === 0 && (
        <Card className="px-6 py-10 text-center">
          <p className="text-[14px] mb-1">No connections yet</p>
          <p className="text-[13px] mb-4" style={{ color: "var(--muted-foreground)" }}>
            Add your first database in Settings to get a browsable console in seconds.
          </p>
          <Button nativeButton={false} render={<Link href="/settings" />}>
            + Add connection
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {connections.map((c) => (
          <ConnectionCard key={c.connectionId} connection={c} />
        ))}
      </div>
    </div>
  );
}

function ConnectionCard({ connection: c }: { connection: LightConnectionCatalog }) {
  return (
    <Link
      href={`/browse/${c.connectionName}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="group p-0 h-full transition-colors hover:bg-accent/40 hover:border-ring/40">
        <div className="px-5 py-4 flex items-start gap-3">
          <div
            className="shrink-0 grid place-items-center size-10 rounded-lg border"
            style={{ borderColor: "var(--border)", background: "var(--muted)" }}
          >
            <EngineIcon engine={c.engine} className="size-6" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-[14px] truncate">{c.connectionName}</span>
              <Badge variant="outline" className="shrink-0">
                {ENGINE_LABELS[c.engine]}
              </Badge>
              {c.error && (
                <Badge variant="destructive" className="shrink-0">
                  <TriangleAlert /> error
                </Badge>
              )}
            </div>

            <div className="text-[12.5px] mt-1 code truncate" style={{ color: "var(--muted-foreground)" }}>
              {c.database}
            </div>

            {c.error ? (
              <p className="text-[11.5px] mt-2 line-clamp-2" style={{ color: "var(--destructive)" }} title={c.error}>
                {c.error}
              </p>
            ) : (
              // Only Postgres has schemas worth counting — for MySQL/Mongo the
              // lone synthetic schema is just the database, already shown above.
              supportsSchemas(c.engine) && (
                <div className="text-[11.5px] mt-2" style={{ color: "var(--muted-foreground-faint)" }}>
                  {pluralize(c.schemas.length, "schema")}
                </div>
              )
            )}
          </div>

          <ChevronRight
            className="size-4 mt-0.5 shrink-0 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0"
            style={{ color: "var(--muted-foreground-faint)" }}
          />
        </div>
      </Card>
    </Link>
  );
}
