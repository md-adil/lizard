"use client";

// Renders raw HTML inside a Shadow DOM so its own styles (and any <style>/
// <link> tags it carries) stay scoped and never leak into — or get clobbered
// by — the app's CSS. Internal-admin-tool trust model: content is not
// sanitized, so only point this at HTML columns the DB operator trusts.
import { useEffect, useRef } from "react";

export function ShadowDom({ html, className }: { html: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) shadowRef.current = host.attachShadow({ mode: "open" });
    shadowRef.current.innerHTML = html;
  }, [html]);

  return <div ref={hostRef} className={className} />;
}
