// Zod validation for model tool output + the matching Anthropic tool
// definitions (JSON Schema). The model's output is untrusted: it must parse
// through these schemas before it goes anywhere near the SQL Guard.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { AiQueryPlan, ChartSpec } from "@/lib/types";

export const QUERY_PLAN_TOOL_NAME = "submit_query_plan";
export const CHART_SPEC_TOOL_NAME = "submit_chart_spec";

// ---------- query plan ----------

export const aiQueryPlanSchema = z
  .object({
    target: z.enum(["single", "federated"]),
    connections: z.array(z.string().min(1)).min(1),
    sql: z.string().min(1),
    dialect: z.enum(["postgres", "duckdb"]),
    explanation: z.string().default(""),
  })
  .transform((plan) => normalizeTargetDialect(plan));

// target implies dialect (single→postgres pool, federated→duckdb). If the
// model slips on the pairing, normalize instead of failing the whole request —
// the guard + router still enforce the invariant at execution time.
function normalizeTargetDialect<
  T extends { target: "single" | "federated"; connections: string[]; dialect: "postgres" | "duckdb" },
>(plan: T): T {
  const target = plan.connections.length > 1 ? "federated" : plan.target;
  return {
    ...plan,
    target,
    dialect: target === "single" ? ("postgres" as const) : ("duckdb" as const),
  };
}

export function parseQueryPlan(input: unknown): AiQueryPlan {
  return aiQueryPlanSchema.parse(input);
}

export const queryPlanTool: Anthropic.Tool = {
  name: QUERY_PLAN_TOOL_NAME,
  description:
    "Submit the final SQL query plan that answers the user's question. Always call this tool exactly once with a single read-only SELECT statement.",
  input_schema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        enum: ["single", "federated"],
        description:
          '"single" when every table lives in ONE connection; "federated" when tables span two or more connections.',
      },
      connections: {
        type: "array",
        items: { type: "string" },
        description: "Names of every connection the SQL reads from.",
      },
      sql: {
        type: "string",
        description:
          "One SELECT statement. No comments, no semicolons. postgres dialect: schema.table refs. duckdb dialect: connection_name.schema.table refs.",
      },
      dialect: {
        type: "string",
        enum: ["postgres", "duckdb"],
        description: '"postgres" when target is "single", "duckdb" when target is "federated".',
      },
      explanation: {
        type: "string",
        description: "One or two plain-language sentences describing what the query computes and how.",
      },
    },
    required: ["target", "connections", "sql", "dialect", "explanation"],
    additionalProperties: false,
  },
};

// ---------- chart spec ----------

export const chartSpecSchema = z
  .object({
    title: z.string().min(1),
    chartType: z.enum(["line", "bar", "pie", "stat", "table", "area"]),
    target: z.enum(["single", "federated"]),
    connections: z.array(z.string().min(1)).min(1),
    sql: z.string().min(1),
    dialect: z.enum(["postgres", "duckdb"]),
    xField: z.string().nullable().default(null),
    yFields: z.array(z.string()).default([]),
    seriesField: z.string().nullable().default(null),
    // User-configured in SpecControls after the fact, not asked of the model
    // (not in chartSpecTool's input_schema below) — always defaulted null.
    linkTo: z.null().default(null),
    thresholds: z.null().default(null),
    cacheSeconds: z.null().default(null),
  })
  .transform((spec) => normalizeTargetDialect(spec));

export function parseChartSpec(input: unknown): ChartSpec {
  return chartSpecSchema.parse(input);
}

export const chartSpecTool: Anthropic.Tool = {
  name: CHART_SPEC_TOOL_NAME,
  description:
    "Submit the final chart specification: a title, chart type, the SQL that produces the data, and which output columns map to the chart axes. Always call this tool exactly once.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short human-readable chart title." },
      chartType: {
        type: "string",
        enum: ["line", "bar", "pie", "stat", "table", "area"],
        description:
          "line/area for values over time, bar for categorical comparison, pie for shares of a whole, stat for a single number, table for raw rows.",
      },
      target: { type: "string", enum: ["single", "federated"] },
      connections: { type: "array", items: { type: "string" } },
      sql: {
        type: "string",
        description:
          "One SELECT statement producing the chart's data. Alias output columns to clean names; those exact names go in xField/yFields/seriesField.",
      },
      dialect: { type: "string", enum: ["postgres", "duckdb"] },
      xField: {
        type: ["string", "null"],
        description: "Output column for the x axis (time or category). null for stat/table charts.",
      },
      yFields: {
        type: "array",
        items: { type: "string" },
        description: "Numeric output column(s) to plot. For stat charts, the single value column.",
      },
      seriesField: {
        type: ["string", "null"],
        description: "Optional categorical output column that splits the data into multiple series, else null.",
      },
    },
    required: ["title", "chartType", "target", "connections", "sql", "dialect", "xField", "yFields", "seriesField"],
    additionalProperties: false,
  },
};
