"use client";

import { useQuery } from "@tanstack/react-query";
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

export default function AuditPage() {
  const { data } = useQuery<AuditRow[]>({
    queryKey: ["audit"],
    queryFn: async () => (await fetch("/api/audit")).json(),
    refetchInterval: 10_000,
  });

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="text-xl font-semibold mb-1">Audit log</h1>
      <p className="text-[13px] mb-6" style={{ color: "var(--muted-foreground)" }}>
        Every query and write Lizard has executed, newest first.
      </p>
      <Card className="p-0 overflow-x-auto scrollbar-thin">
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
            {data?.map((r) => (
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
                <TableCell
                  className="max-w-xs truncate"
                  style={{ color: "var(--destructive)" }}
                  title={r.error ?? ""}
                >
                  {r.error ? r.error.slice(0, 60) : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data?.length === 0 && (
          <p className="px-5 py-8 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
            Nothing logged yet.
          </p>
        )}
      </Card>
    </div>
  );
}
