// AI text-to-SQL / text-to-chart planning. The model only ever produces a
// structured plan (validated with zod); execution always goes through the SQL
// Guard + read-only roles. The guard, not the prompt, is the security boundary.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AiQueryPlan, Catalog, ChartSpec } from "@/lib/types";
import { getCatalog } from "@/lib/introspect/catalog";
import { vfkSummary } from "@/lib/introspect/virtual-fk";

const MODEL = () => process.env.LIZARD_AI_MODEL || "claude-sonnet-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Set ANTHROPIC_API_KEY in the environment to enable AI querying (see .env.example).");
  }
  if (!client) client = new Anthropic();
  return client;
}

// ---------- compact catalog serialization ----------

export function serializeCatalog(catalog: Catalog, scope?: string[]): string {
  const parts: string[] = [];
  for (const conn of catalog.connections) {
    if (scope && scope.length > 0 && !scope.includes(conn.connectionName)) continue;
    if (conn.error) continue;
    parts.push(`connection ${conn.connectionName} (${conn.engine} database "${conn.database}")`);
    for (const schema of conn.schemas) {
      for (const t of schema.tables) {
        const cols = t.columns
          .map((c) => {
            const bits = [c.name, c.udtName];
            if (t.primaryKey.includes(c.name)) bits.push("pk");
            const fk = t.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === c.name);
            if (fk) bits.push(`fk→${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumns[0]}`);
            if (c.enumValues?.length) bits.push(`enum:${c.enumValues.join("|")}`);
            if (!c.nullable) bits.push("nn");
            return bits.join(" ");
          })
          .join(", ");
        const comment = t.comment ? ` — ${t.comment}` : "";
        parts.push(
          `  ${schema.name}.${t.name} (~${t.rowEstimate} rows${t.kind === "view" ? ", view" : ""})${comment}: ${cols}`,
        );
      }
    }
  }
  const vfks = catalog.virtualFks.filter(
    (v) => !scope || scope.length === 0 || (scope.includes(v.fromConnection) && scope.includes(v.toConnection)),
  );
  for (const v of vfks) {
    parts.push(`VIRTUAL FK: ${v.fromConnection}.${v.fromSchema}.${v.fromTable} → ${vfkSummary(v)}`);
  }
  return parts.join("\n");
}

// ---------- plans & validation ----------

const planSchema = z.object({
  target: z.enum(["single", "federated"]),
  connections: z.array(z.string()).min(1),
  sql: z.string().min(1),
  dialect: z.enum(["postgres", "mysql", "duckdb"]),
  explanation: z.string(),
});

const chartSpecSchema = z.object({
  title: z.string(),
  chartType: z.enum(["line", "bar", "pie", "stat", "table", "area"]),
  target: z.enum(["single", "federated"]),
  connections: z.array(z.string()).min(1),
  sql: z.string().min(1),
  dialect: z.enum(["postgres", "mysql", "duckdb"]),
  xField: z.string().nullable(),
  yFields: z.array(z.string()),
  seriesField: z.string().nullable(),
});

function systemPrompt(schemaText: string): string {
  return `You are Lizard's SQL planner for a fleet of Postgres and MySQL microservice databases. Today is ${new Date().toISOString().slice(0, 10)}.

DATABASE FLEET SCHEMA:
${schemaText}

RULES (strict):
- SELECT only. One single statement. No comments. No semicolons. Never any DML/DDL.
- Decide the target:
  - If every table you need lives in ONE connection:
    - target: "single"
    - dialect: the connection's database engine ("postgres" or "mysql")
    - connections: [that connection]
    - Table references:
      - For postgres: qualify as "schema.table" (e.g. "public.users").
      - For mysql: qualify as "table" (e.g. "users") (do NOT prefix with schema or database name, quote using backticks if necessary).
  - If tables span MULTIPLE connections:
    - target: "federated"
    - dialect: "duckdb"
    - connections: all involved connections
    - Table references: EVERY table reference MUST be fully qualified as connection_name.schema.table (e.g. "users_service.public.users" for postgres tables, and "orders_service.orders_service.orders" for mysql tables since mysql maps database to a synthetic schema name equal to the database).
- DuckDB dialect is Postgres-like: date_trunc, intervals, joins, CTEs all work. Prefer ANSI SQL that works in both.
- Cross-connection joins have no real foreign keys — use the declared VIRTUAL FK hints.
- Use enum values exactly as listed. Quote nothing that doesn't need quoting.
- Prefer an explicit LIMIT for top-N questions; keep result sets small and aggregate where sensible.
- Money columns named *_cents are integer cents: divide by 100.0 for currency amounts.
- explanation: one or two plain-language sentences of what the query does and which services it touches.`;
}

export async function planQuery(
  question: string,
  scope?: string[],
  history?: { question: string; sql: string }[],
): Promise<AiQueryPlan> {
  const catalog = await getCatalog();
  const schemaText = serializeCatalog(catalog, scope);
  const messages: Anthropic.MessageParam[] = [];
  for (const h of history ?? []) {
    messages.push({ role: "user", content: h.question });
    messages.push({ role: "assistant", content: `Previous SQL:\n${h.sql}` });
  }
  messages.push({ role: "user", content: question });

  const res = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 1500,
    system: systemPrompt(schemaText),
    messages,
    tools: [
      {
        name: "sql_plan",
        description: "Return the SQL plan answering the user's question.",
        input_schema: {
          type: "object" as const,
          properties: {
            target: { type: "string", enum: ["single", "federated"] },
            connections: { type: "array", items: { type: "string" } },
            sql: { type: "string" },
            dialect: { type: "string", enum: ["postgres", "mysql", "duckdb"] },
            explanation: { type: "string" },
          },
          required: ["target", "connections", "sql", "dialect", "explanation"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "sql_plan" },
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Model did not return a structured plan");
  return planSchema.parse(block.input);
}

export async function planChart(prompt: string, scope?: string[]): Promise<ChartSpec> {
  const catalog = await getCatalog();
  const schemaText = serializeCatalog(catalog, scope);

  const res = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 1500,
    system:
      systemPrompt(schemaText) +
      `\n\nYou are planning a CHART. Additional rules:
- The SQL's output columns feed the chart: xField and every yFields entry MUST be output column names of your SQL.
- chartType: "line"/"area" for time series (x temporal), "bar" for categorical comparisons, "pie" only for ≤8 categories share-of-whole, "stat" for a single number, "table" otherwise.
- seriesField: optional categorical output column that splits into multiple series.
- Aggregate to a sensible grain (e.g. per month) and ORDER BY the x column.`,
    messages: [{ role: "user", content: prompt }],
    tools: [
      {
        name: "chart_spec",
        description: "Return the chart specification.",
        input_schema: {
          type: "object" as const,
          properties: {
            title: { type: "string" },
            chartType: { type: "string", enum: ["line", "bar", "pie", "stat", "table", "area"] },
            target: { type: "string", enum: ["single", "federated"] },
            connections: { type: "array", items: { type: "string" } },
            sql: { type: "string" },
            dialect: { type: "string", enum: ["postgres", "mysql", "duckdb"] },
            xField: { type: ["string", "null"] },
            yFields: { type: "array", items: { type: "string" } },
            seriesField: { type: ["string", "null"] },
          },
          required: [
            "title",
            "chartType",
            "target",
            "connections",
            "sql",
            "dialect",
            "xField",
            "yFields",
            "seriesField",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: "chart_spec" },
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Model did not return a chart spec");
  return chartSpecSchema.parse(block.input);
}
