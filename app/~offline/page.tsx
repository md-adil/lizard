"use client";

// Served by the service worker (see app/sw.ts's `fallbacks` config) in place
// of any navigation that fails with no network — precached at build time via
// additionalPrecacheEntries in next.config.ts. Every real page needs a live
// query, so there's nothing more useful to show than "try again."
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OfflinePage() {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
      <WifiOff className="size-8" style={{ color: "var(--muted-foreground-faint)" }} />
      <div>
        <h1 className="text-base font-semibold">You&apos;re offline</h1>
        <p className="text-[13px] mt-1" style={{ color: "var(--muted-foreground)" }}>
          Lizard needs a connection to your databases — this page will load once you&apos;re back online.
        </p>
      </div>
      <Button size="sm" onClick={() => location.reload()}>
        Retry
      </Button>
    </div>
  );
}
