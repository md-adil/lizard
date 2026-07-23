import type { Metadata, Viewport } from "next";
import NextTopLoader from "nextjs-toploader";
import { SerwistProvider } from "@serwist/turbopack/react";

import "./globals.css";
import "@xyflow/react/dist/style.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Lizard",
  description: "AI-native data console for your Postgres fleet",
};

export const viewport: Viewport = {
  themeColor: "#7c3aed",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className="antialiased">
        <NextTopLoader color="var(--color-primary)" />
        {/* Registers the offline/app-shell service worker (app/sw.ts) — a
            no-op in development so an active SW can't shadow live-reloaded
            code while iterating. */}
        <SerwistProvider swUrl="/sw.js" disable={process.env.NODE_ENV === "development"}>
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </SerwistProvider>
        <Toaster />
      </body>
    </html>
  );
}
