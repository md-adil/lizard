"use client";

// Thin wrapper around next-themes for callers that only need the resolved
// theme as "dark" | "light" (never "system") -- e.g. chart color palettes.
// For toggling, use next-themes' own `useTheme()` directly (see sidebar.tsx).
import { useTheme as useNextTheme } from "next-themes";

export type ThemeName = "dark" | "light";

export function useTheme(): ThemeName {
  const { resolvedTheme } = useNextTheme();
  return resolvedTheme === "light" ? "light" : "dark";
}
