"use client";

// Renders a parsed JSON value as a readable, structured tree instead of a raw
// code dump: humanized keys, nested objects as indented sections, primitive
// arrays as chips, object arrays as compact stacked rows. Theme-aware.
import type { ReactNode } from "react";
import { humanize } from "@/lib/introspect/heuristics";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s);
}

function Primitive({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span style={{ color: "var(--muted-foreground-faint)" }}>∅</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="tag" style={{ color: value ? "var(--success)" : "var(--muted-foreground)", fontSize: 11 }}>
        {value ? "✓ true" : "✗ false"}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span style={{ color: "var(--info)" }}>{Intl.NumberFormat("en").format(value)}</span>;
  }
  const s = String(value);
  if (looksLikeUrl(s)) {
    return (
      <a href={s} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }} className="underline break-all">
        {s}
      </a>
    );
  }
  return (
    <span style={{ color: "var(--foreground)" }} className="break-words">
      {s}
    </span>
  );
}

const JSON_TOKEN_RE =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

// Colorizes a JSON.stringify'd string for the raw-JSON view — keys, strings,
// numbers, booleans, and null each get their own color, matching Primitive's palette.
export function JsonSyntax({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  JSON_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSON_TOKEN_RE.exec(text))) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    const token = m[0];
    let color = "var(--info)"; // number
    if (token.startsWith('"')) {
      color = /:\s*$/.test(token) ? "var(--primary)" : "var(--success)";
    } else if (token === "true" || token === "false") {
      color = "var(--warning)";
    } else if (token === "null") {
      color = "var(--muted-foreground-faint)";
    }
    nodes.push(
      <span key={key++} style={{ color }}>
        {token}
      </span>,
    );
    lastIndex = m.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}

function KeyLabel({ name }: { name: string }) {
  return (
    <span
      className="text-[11px] font-medium uppercase tracking-wide shrink-0"
      style={{ color: "var(--muted-foreground-faint)" }}
    >
      {humanize(name)}
    </span>
  );
}

export function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  // empty
  if (value === null || value === undefined) return <Primitive value={value} />;

  // arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: "var(--muted-foreground-faint)" }}>—</span>;
    const allPrimitive = value.every((v) => v === null || typeof v !== "object");
    if (allPrimitive) {
      return (
        <div className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <span key={i} className="tag" style={{ fontSize: 11.5 }}>
              <Primitive value={v} />
            </span>
          ))}
        </div>
      );
    }
    // array of objects/mixed → stacked rows
    return (
      <div className="space-y-1.5">
        {value.map((v, i) => (
          <div key={i} className="rounded-md border px-2.5 py-2" style={{ borderColor: "var(--border)" }}>
            <div className="text-[10.5px] mb-1" style={{ color: "var(--muted-foreground-faint)" }}>
              #{i + 1}
            </div>
            <JsonView value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  // objects
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span style={{ color: "var(--muted-foreground-faint)" }}>{"{}"}</span>;
    return (
      <div className="space-y-2">
        {entries.map(([k, v], i) => {
          const nested = isPlainObject(v) || (Array.isArray(v) && v.some((x) => typeof x === "object" && x !== null));
          const divider =
            i > 0
              ? { borderTopWidth: 1, borderTopStyle: "dashed" as const, borderTopColor: "var(--border)", paddingTop: 8 }
              : {};
          if (nested) {
            return (
              <div key={k} className="pl-3 border-l" style={{ borderColor: "var(--input)", ...divider }}>
                <div className="mb-1">
                  <KeyLabel name={k} />
                </div>
                <JsonView value={v} depth={depth + 1} />
              </div>
            );
          }
          return (
            <div key={k} className="flex items-baseline gap-3" style={divider}>
              <span className="w-32 shrink-0">
                <KeyLabel name={k} />
              </span>
              <span className="text-[13px] min-w-0">
                <JsonView value={v} depth={depth + 1} />
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // primitive
  return <Primitive value={value} />;
}
