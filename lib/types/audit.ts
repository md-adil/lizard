export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  sql: string | null;
  connections: string | null;
  rowCount: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}
