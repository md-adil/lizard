"use client";

import { useQuery } from "@tanstack/react-query";

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
      <p className="text-[13px] mb-6" style={{ color: "var(--text-dim)" }}>
        Every query and write Lizard has executed, newest first.
      </p>
      <div className="panel overflow-x-auto scrollbar-thin">
        <table className="grid">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Connections</th>
              <th>SQL</th>
              <th>Rows</th>
              <th>ms</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.id}>
                <td style={{ color: "var(--text-dim)" }}>{r.created_at}</td>
                <td>
                  <span className="tag">{r.action}</span>
                </td>
                <td className="code">{r.connections ? JSON.parse(r.connections).join(", ") : ""}</td>
                <td className="code" title={r.sql ?? ""}>
                  {r.sql}
                </td>
                <td>{r.row_count ?? ""}</td>
                <td style={{ color: "var(--text-dim)" }}>{r.duration_ms ?? ""}</td>
                <td style={{ color: "var(--red)" }} title={r.error ?? ""}>
                  {r.error ? r.error.slice(0, 60) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && (
          <p className="px-5 py-8 text-center text-[13px]" style={{ color: "var(--text-dim)" }}>
            Nothing logged yet.
          </p>
        )}
      </div>
    </div>
  );
}
