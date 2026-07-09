"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-context";
import { useCatalog } from "@/components/browse/useTableMeta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

      {isLoading && <p style={{ color: "var(--muted-foreground)" }}>Loading…</p>}

      {!isLoading && connections.length === 0 && (
        <Card className="px-6 py-10 text-center">
          <p className="text-[14px] mb-1">No connections yet</p>
          <p className="text-[13px] mb-4" style={{ color: "var(--muted-foreground)" }}>
            Add your first Postgres database in Settings to get a browsable console in seconds.
          </p>
          <Button nativeButton={false} render={<Link href="/settings" />}>
            + Add connection
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {connections.map((c) => {
          return (
            <Link key={c.connectionId} href={`/browse/${c.connectionName}`} className="block">
              <Card className="p-0 hover:bg-accent/40 transition-colors">
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[14px]">{c.connectionName}</span>
                    {c.error && (
                      <span className="tag" style={{ color: "var(--destructive)" }}>
                        error
                      </span>
                    )}
                  </div>
                  <div className="text-[12.5px] mt-1 code" style={{ color: "var(--muted-foreground)" }}>
                    {c.database}
                  </div>
                  {!c.error && (
                    <div className="text-[11.5px] mt-2" style={{ color: "var(--muted-foreground-faint)" }}>
                      {pluralize(c.schemas.length, "schema")}
                    </div>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
