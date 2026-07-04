"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { useAuth } from "@/components/auth-context";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAuthPage = pathname === "/login";

  useEffect(() => {
    if (!loading && !user && !isAuthPage) router.replace("/login");
  }, [loading, user, isAuthPage, router]);

  // login page renders standalone (no chrome)
  if (isAuthPage) return <>{children}</>;

  if (loading || !user) {
    return (
      <div className="h-screen flex items-center justify-center text-[13px]" style={{ color: "var(--text-dim)" }}>
        {loading ? "Loading…" : "Redirecting to sign in…"}
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto scrollbar-thin">{children}</main>
    </div>
  );
}
