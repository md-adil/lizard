import type { QueryResult } from "@/lib/types";

// Minimal RFC4180 quoting: wrap a field in quotes and double up any internal
// quotes if it contains a comma, quote, or newline; otherwise leave it bare.
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function resultToCsv(result: QueryResult): string {
  const header = result.columns.map((c) => csvField(c.name)).join(",");
  const lines = result.rows.map((row) => result.columns.map((c) => csvField(row[c.name])).join(","));
  return [header, ...lines].join("\r\n");
}

// Triggers a browser download of a Blob via a transient <a download> click —
// no server round-trip, the data's already in the browser.
export function downloadBlob(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
