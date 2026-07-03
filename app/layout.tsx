import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Lizard",
  description: "AI-native data console for your Postgres fleet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeInit = `try{var t=localStorage.getItem("lizard.theme");if(!t)t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){}`;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="antialiased">
        <Providers>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-auto scrollbar-thin">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
