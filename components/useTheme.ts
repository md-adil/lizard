"use client";

import { useEffect, useState } from "react";

export type ThemeName = "dark" | "light";

export function useTheme(): ThemeName {
  const [theme, setTheme] = useState<ThemeName>("dark");
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setTheme(el.dataset.theme === "light" ? "light" : "dark");
    update();
    const mo = new MutationObserver(update);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

export function toggleTheme(): void {
  const el = document.documentElement;
  const next = el.dataset.theme === "light" ? "dark" : "light";
  el.dataset.theme = next;
  try {
    localStorage.setItem("lizard.theme", next);
  } catch {
    /* ignore */
  }
}
