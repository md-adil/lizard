// Text-to-SQL + text-to-chart generation. The model is forced into a
// structured tool call whose input is zod-validated; free text is never
// executed. The SQL Guard (lib/guard) remains the real security boundary —
// everything produced here still goes through runGuardedQuery.
import type Anthropic from "@anthropic-ai/sdk";
import type { AiQueryPlan, ChartSpec } from "@/lib/types";
import { getCatalog } from "@/lib/introspect/catalog";
import { getAnthropicClient, AI_MODEL } from "./client";
import { serializeCatalog } from "./catalog";
import {
  queryPlanTool,
  chartSpecTool,
  parseQueryPlan,
  parseChartSpec,
  QUERY_PLAN_TOOL_NAME,
  CHART_SPEC_TOOL_NAME,
} from "./schemas";

const MAX_TOKENS = 8192;

export interface HistoryTurn {
  question: string;
  plan: Pick<AiQueryPlan, "target" | "connections" | "sql" | "dialect"> & { explanation?: string };
}

const SQL_RULES = `Rules for the SQL you produce:
- Exactly ONE SELECT statement (WITH/CTEs are fine). Read-only, always.
- No SQL comments. No semicolons. No DDL/DML, no COPY, no system/administrative functions.
- Decide the target:
  - If every table you need lives in ONE connection → target "single", dialect "postgres". Reference tables as schema.table (e.g. public.users).
  - If tables span two or more connections → target "federated", dialect "duckdb". Reference EVERY table fully qualified as connection_name.schema.table — the connection name is the attached database alias in DuckDB.
- List every connection you read from in "connections" (exactly one for single, all of them for federated).
- DuckDB dialect notes: it is Postgres-like. date_trunc, interval arithmetic, FILTER clauses, window functions all work. Prefer standard SQL.
- Join across services ONLY via the declared virtual FK links in the schema; do not invent join keys.
- Use enum values EXACTLY as listed in the schema (case-sensitive).
- Prefer an explicit LIMIT for top-N style questions; results are hard-capped at 1000 rows regardless.
- Prefer readable output column aliases (snake_case).
- If a question is ambiguous, make a reasonable assumption and state it in the explanation.`;

function buildSystemPrompt(schemaText: string, kind: "query" | "chart"): string {
  const today = new Date().toISOString().slice(0, 10);
  const intro =
    kind === "query"
      ? `You are Lizard's SQL analyst. You translate natural-language questions about the databases below into a single read-only SQL query, submitted via the ${QUERY_PLAN_TOOL_NAME} tool.`
      : `You are Lizard's chart planner. You translate a chart request about the databases below into a chart specification (chart type + a single read-only SQL query + axis field mapping), submitted via the ${CHART_SPEC_TOOL_NAME} tool.`;

  const chartRules =
    kind === "chart"
      ? `\n\nChart-specific rules:
- xField, yFields and seriesField MUST be output column names (aliases) of your SQL.
- For time series, return the time column pre-bucketed (e.g. date_trunc('month', ...)) and ORDER BY it.
- "stat" charts: SQL returns one row; yFields holds the single value column; xField is null.
- "table" charts: xField null, yFields empty.`
      : "";

  return `${intro}

Today's date is ${today} (use it to resolve relative time ranges like "last month").

${SQL_RULES}${chartRules}

Database schema (every registered connection):

${schemaText}`;
}

function extractToolInput(message: Anthropic.Message, toolName: string): unknown {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === toolName) return block.input;
  }
  throw new Error("The model did not return a structured plan. Try rephrasing the question.");
}

async function schemaForScope(connections?: string[]): Promise<string> {
  const catalog = await getCatalog();
  if (catalog.connections.length === 0) {
    throw new Error("No connections registered. Add a Postgres connection first.");
  }
  return serializeCatalog(catalog, { connections });
}

export async function generateQueryPlan(
  question: string,
  connections?: string[],
  history: HistoryTurn[] = []
): Promise<AiQueryPlan> {
  const client = getAnthropicClient();
  const schemaText = await schemaForScope(connections);

  const messages: Anthropic.MessageParam[] = [];
  for (const turn of history) {
    messages.push({ role: "user", content: turn.question });
    messages.push({
      role: "assistant",
      content: `Previously generated plan — target: ${turn.plan.target}, connections: ${turn.plan.connections.join(
        ", "
      )}, dialect: ${turn.plan.dialect}\nSQL:\n${turn.plan.sql}`,
    });
  }
  messages.push({ role: "user", content: question });

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(schemaText, "query"),
    tools: [queryPlanTool],
    tool_choice: { type: "tool", name: QUERY_PLAN_TOOL_NAME },
    messages,
  });

  return parseQueryPlan(extractToolInput(response, QUERY_PLAN_TOOL_NAME));
}

export async function generateChartSpec(prompt: string, connections?: string[]): Promise<ChartSpec> {
  const client = getAnthropicClient();
  const schemaText = await schemaForScope(connections);

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(schemaText, "chart"),
    tools: [chartSpecTool],
    tool_choice: { type: "tool", name: CHART_SPEC_TOOL_NAME },
    messages: [{ role: "user", content: prompt }],
  });

  return parseChartSpec(extractToolInput(response, CHART_SPEC_TOOL_NAME));
}
