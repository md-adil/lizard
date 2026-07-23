"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Sidebar } from "@/components/sidebar";
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
      <div
        className="h-screen flex items-center justify-center text-[13px]"
        style={{ color: "var(--muted-foreground)" }}
      >
        {loading ? "Loading…" : "Redirecting to sign in…"}
      </div>
    );
  }

  return (
    <SidebarProvider className="h-svh overflow-hidden" style={{ "--sidebar-width": "17rem" } as React.CSSProperties}>
      <Sidebar />
      <SidebarInset className="h-screen overflow-auto scrollbar-thin p-4" style={{ scrollbarGutter: "stable" }}>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
