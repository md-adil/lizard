"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Sidebar } from "@/components/sidebar";
import { useAuth } from "@/components/auth-context";
import { CommandPaletteProvider, CommandPaletteTrigger } from "@/components/command-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAuthPage = pathname === "/login";
  // The service worker's offline fallback (see app/sw.ts) — it has to
  // render with zero network, so it can't wait on (or redirect from) an
  // auth check that itself needs a round trip.
  const isOfflinePage = pathname === "/~offline";

  useEffect(() => {
    if (!loading && !user && !isAuthPage && !isOfflinePage) router.replace("/login");
  }, [loading, user, isAuthPage, isOfflinePage, router]);

  // login and offline pages render standalone (no chrome, no auth gate)
  if (isAuthPage || isOfflinePage) return <>{children}</>;

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
    <CommandPaletteProvider>
      <SidebarProvider className="h-svh overflow-hidden" style={{ "--sidebar-width": "17rem" } as React.CSSProperties}>
        <Sidebar />
        <SidebarInset
          className="relative h-screen overflow-auto scrollbar-thin p-4"
          style={{ scrollbarGutter: "stable" }}
        >
          {/* Global search affordance, pinned to the top-right of the content
              column. Absolute so it lands in the breadcrumb row each page
              renders (and scrolls away with it); ⌘K opens it from anywhere. */}
          <CommandPaletteTrigger className="absolute right-4 top-2 z-20" />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </CommandPaletteProvider>
  );
}
