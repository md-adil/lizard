"use client";

import type { QueryResult } from "@/lib/types";

export function ResultGrid({ result, maxRows = 100 }: { result: QueryResult; maxRows?: number }) {
  const rows = result.rows.slice(0, maxRows);
  return (
    <div>
      <div className="panel overflow-x-auto scrollbar-thin" style={{ maxHeight: 420, overflowY: "auto" }}>
        <table className="grid">
          <thead>
            <tr>
              {result.columns.map((c) => (
                <th key={c.name} title={c.type}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {result.columns.map((c) => {
                  const v = row[c.name];
                  return (
                    <td key={c.name} title={String(v ?? "")}>
                      {v === null || v === undefined ? (
                        <span style={{ color: "var(--text-faint)" }}>∅</span>
                      ) : typeof v === "object" ? (
                        JSON.stringify(v)
                      ) : (
                        String(v)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--text-dim)" }}>
            No rows returned.
          </p>
        )}
      </div>
      <div className="flex gap-3 mt-1.5 text-[12px]" style={{ color: "var(--text-faint)" }}>
        <span>{result.rowCount.toLocaleString()} rows{result.truncated && " (truncated at cap)"}</span>
        <span>{result.durationMs} ms</span>
        {result.rowCount > maxRows && <span>showing first {maxRows}</span>}
      </div>
    </div>
  );
}
