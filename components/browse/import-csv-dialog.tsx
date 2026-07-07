"use client";

// Phase 8.7 — CSV import: parse (papaparse), map CSV headers to table
// columns, preview, then bulk-insert through /import. Partial success is
// expected and reported — one bad row shouldn't block the rest.
import { useState } from "react";
import Papa from "papaparse";
import type { TableMeta } from "./useTableMeta";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const SKIP = "__skip__";

export function ImportCsvDialog({
  meta,
  onClose,
  onImported,
}: {
  meta: TableMeta;
  onClose: () => void;
  onImported: () => void;
}) {
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    inserted: number;
    errors: { row: number; message: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = meta.columns.filter((c) => !c.readonly);

  function onFile(file: File) {
    setError(null);
    setResult(null);
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data;
        if (data.length === 0) {
          setError("File is empty");
          return;
        }
        const [head, ...body] = data;
        setHeaders(head);
        setRows(body);
        // auto-match by exact or case-insensitive column name
        const auto: Record<string, string> = {};
        for (const h of head) {
          const hit = columns.find((c) => c.col.name.toLowerCase() === h.trim().toLowerCase());
          auto[h] = hit ? hit.col.name : SKIP;
        }
        setMapping(auto);
      },
      error: (err) => setError(err.message),
    });
  }

  async function doImport() {
    if (!headers) return;
    const mapped = rows.map((r) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        const col = mapping[h];
        if (col && col !== SKIP) obj[col] = r[i] === "" ? null : r[i];
      });
      return obj;
    });
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/data/${meta.connection}/${meta.schema}/${meta.table.name}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: mapped }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Import failed");
      setResult(body);
      if (body.errors.length === 0) onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const mappedCount = headers ? Object.values(mapping).filter((v) => v !== SKIP).length : 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex flex-col gap-3" style={{ width: 640, maxWidth: "95vw", maxHeight: "85vh" }}>
        <DialogTitle>Import CSV — {meta.label}</DialogTitle>

        {!headers ? (
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin space-y-3">
            <p className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
              {rows.length} row{rows.length === 1 ? "" : "s"} found · map each CSV column to a table column (
              {mappedCount} mapped)
            </p>
            <div className="space-y-1.5">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 truncate code text-[12.5px]" title={h}>
                    {h}
                  </span>
                  <span style={{ color: "var(--muted-foreground-faint)" }}>→</span>
                  <Select
                    value={mapping[h] ?? SKIP}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v as string }))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP}>— skip —</SelectItem>
                      {columns.map((c) => (
                        <SelectItem key={c.col.name} value={c.col.name}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {rows.length > 0 && (
              <div>
                <div
                  className="text-[11px] font-semibold uppercase tracking-wider mb-1"
                  style={{ color: "var(--muted-foreground-faint)" }}
                >
                  Preview (first 3 rows)
                </div>
                <div className="text-[12px] space-y-1">
                  {rows.slice(0, 3).map((r, i) => (
                    <div key={i} className="code truncate" style={{ color: "var(--muted-foreground-faint)" }}>
                      {r.join(" · ")}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result && (
              <div className="text-[13px]">
                <p style={{ color: "var(--success)" }}>
                  Imported {result.inserted} row
                  {result.inserted === 1 ? "" : "s"}.
                </p>
                {result.errors.length > 0 && (
                  <div className="mt-1" style={{ color: "var(--destructive)" }}>
                    <p>{result.errors.length} row(s) failed:</p>
                    <ul className="ml-4 list-disc">
                      {result.errors.slice(0, 10).map((e, i) => (
                        <li key={i}>
                          row {e.row + 1}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
            {error}
          </p>
        )}

        <DialogFooter>
          {headers && !result && (
            <Button disabled={importing || mappedCount === 0} onClick={doImport}>
              {importing ? "Importing…" : `Import ${rows.length} rows`}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
