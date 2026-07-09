import type { QueryTarget, SqlDialect } from "./query";

export interface AiQueryPlan {
  target: QueryTarget;
  connections: string[];
  sql: string;
  dialect: SqlDialect;
  explanation: string;
}
