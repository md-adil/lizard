"use client";

// Admin-only audit trail (the API is requireAdmin) — lives as a Settings tab
// rather than global nav so non-admins don't see a dead link.
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface AuditRow {
  id: number;
  actor: string;
  action: string;
  sql: string | null;
  connections: string | null;
  row_count: number | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

interface AuditResponse {
  rows: AuditRow[];
  total: number;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

export function AuditTab() {
  const [page, setPage] = useState(0);
  const { data } = useQuery<AuditResponse>({
    queryKey: ["audit", page],
    queryFn: async () => (await fetch(`/api/audit?page=${page}&pageSize=${PAGE_SIZE}`)).json(),
    placeholderData: keepPreviousData,
    // Auto-refresh only makes sense on the newest page — refetching page 3
    // every 10s would shift rows underneath the reader as new entries land.
    refetchInterval: page === 0 ? 10_000 : false,
  });
  const rows = data?.rows;

  return (
    <div>
      <p className="text-[13px] mb-4" style={{ color: "var(--muted-foreground)" }}>
        Every query and write Lizard has executed, newest first.
      </p>
      <Card className="p-0 overflow-x-auto scrollbar-thin w-full">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Connections</TableHead>
              <TableHead>SQL</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>ms</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows?.map((r) => (
              <TableRow key={r.id}>
                <TableCell style={{ color: "var(--muted-foreground)" }}>{r.created_at}</TableCell>
                <TableCell>
                  <span className="tag">{r.action}</span>
                </TableCell>
                <TableCell className="code">{r.connections ? JSON.parse(r.connections).join(", ") : ""}</TableCell>
                <TableCell className="code max-w-md truncate" title={r.sql ?? ""}>
                  {r.sql}
                </TableCell>
                <TableCell>{r.row_count ?? ""}</TableCell>
                <TableCell style={{ color: "var(--muted-foreground)" }}>{r.duration_ms ?? ""}</TableCell>
                <TableCell className="max-w-xs truncate" style={{ color: "var(--destructive)" }} title={r.error ?? ""}>
                  {r.error ? r.error.slice(0, 60) : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows?.length === 0 && (
          <p className="px-5 py-8 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
            {page === 0 ? "Nothing logged yet." : "No entries on this page."}
          </p>
        )}
      </Card>
      <div className="flex items-center gap-3 mt-3 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
        <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ← Prev
        </Button>
        <span>
          Page {page + 1}
          {data?.total != null && <> · {data.total.toLocaleString()} entries</>}
        </span>
        <Button variant="secondary" size="sm" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>
          Next →
        </Button>
      </div>
    </div>
  );
}
