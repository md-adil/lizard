"use client";

// AI query console (Phase 4): ask in plain language across one or many
// databases; the generated SQL and the connections touched are always shown.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiQueryPlan, QueryResult, SavedQuery } from "@/lib/types";
import { ResultGrid } from "@/components/ai/result-grid";
import { VisualizeButton } from "@/components/charts/visualize-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCatalog } from "@/components/browse/use-catalog";

interface Turn {
  question: string;
  plan?: AiQueryPlan;
  result?: QueryResult;
  error?: string;
  running?: boolean;
  editedSql?: string;
  editing?: boolean;
}

export default function AiConsole() {
  const qc = useQueryClient();
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: catalog } = useCatalog();
  const { data: saved } = useQuery<SavedQuery[]>({
    queryKey: ["saved-queries"],
    queryFn: async () => (await fetch("/api/saved-queries")).json(),
  });

  const connections = catalog?.connections.filter((c) => !c.error).map((c) => c.connectionName) ?? [];

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    setBusy(true);
    setTurns((s) => [...s, { question: q, running: true }]);
    try {
      const history = turns
        .filter((t) => t.plan)
        .slice(-4)
        .map((t) => ({ question: t.question, sql: t.plan!.sql }));
      const res = await fetch("/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, connections: scope.length ? scope : undefined, history }),
      });
      const body = await res.json();
      setTurns((s) =>
        s.map((t, i) =>
          i === s.length - 1
            ? {
                question: q,
                plan: body.plan,
                result: body.result,
                error: body.error ?? (!res.ok ? (body.error ?? "Request failed") : undefined),
              }
            : t,
        ),
      );
      if (!res.ok) {
        setTurns((s) =>
          s.map((t, i) => (i === s.length - 1 ? { question: q, error: body.error ?? "Request failed" } : t)),
        );
      }
    } catch (e) {
      setTurns((s) => s.map((t, i) => (i === s.length - 1 ? { question: q, error: String(e) } : t)));
    } finally {
      setBusy(false);
    }
  };

  const rerun = async (idx: number, sql: string) => {
    const t = turns[idx];
    if (!t.plan) return;
    setTurns((s) => s.map((x, i) => (i === idx ? { ...x, running: true } : x)));
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: t.plan.target, connections: t.plan.connections, sql, dialect: t.plan.dialect }),
    });
    const body = await res.json();
    setTurns((s) =>
      s.map((x, i) =>
        i === idx
          ? {
              ...x,
              running: false,
              editing: false,
              plan: { ...x.plan!, sql },
              result: res.ok ? body : undefined,
              error: res.ok ? undefined : body.error,
            }
          : x,
      ),
    );
  };

  const saveQuery = async (t: Turn) => {
    if (!t.plan) return;
    const name = prompt("Name this query:", t.question.slice(0, 60));
    if (!name) return;
    await fetch("/api/saved-queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        nlPrompt: t.question,
        target: t.plan.target,
        connections: t.plan.connections,
        sql: t.plan.sql,
        dialect: t.plan.dialect,
      }),
    });
    qc.invalidateQueries({ queryKey: ["saved-queries"] });
  };

  const runSaved = async (sq: SavedQuery) => {
    setTurns((s) => [...s, { question: sq.nlPrompt ?? sq.name, running: true }]);
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: sq.target, connections: sq.connections, sql: sq.sql, dialect: sq.dialect }),
    });
    const body = await res.json();
    setTurns((s) =>
      s.map((t, i) =>
        i === s.length - 1
          ? {
              question: sq.nlPrompt ?? sq.name,
              plan: {
                target: sq.target,
                connections: sq.connections,
                sql: sq.sql,
                dialect: sq.dialect,
                explanation: `Saved query “${sq.name}”.`,
              },
              result: res.ok ? body : undefined,
              error: res.ok ? undefined : body.error,
            }
          : t,
      ),
    );
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col max-w-4xl mx-auto px-8 py-8 w-full">
        <h1 className="text-xl font-semibold mb-1">Ask your databases</h1>
        <p className="text-[13px] mb-4" style={{ color: "var(--muted-foreground)" }}>
          Plain-language questions over one database or the whole fleet. The SQL and the databases touched are always
          shown; everything is read-only and guarded.
        </p>

        <div className="flex gap-1.5 mb-3 flex-wrap">
          <span className="text-[12px] mt-1" style={{ color: "var(--muted-foreground-faint)" }}>
            Scope:
          </span>
          <button
            className="tag"
            style={scope.length === 0 ? { color: "var(--primary)", borderColor: "var(--primary)" } : {}}
            onClick={() => setScope([])}
          >
            all connections
          </button>
          {connections.map((c) => (
            <button
              key={c}
              className="tag"
              style={scope.includes(c) ? { color: "var(--primary)", borderColor: "var(--primary)" } : {}}
              onClick={() => setScope((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-6">
          <Input
            className="h-auto py-2.5 text-sm"
            placeholder='e.g. "top 10 customers by order revenue last 90 days"'
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
          />
          <Button disabled={busy || !question.trim()} onClick={ask}>
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto scrollbar-thin pb-8">
          {turns.length === 0 && (
            <div className="panel px-6 py-8 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              Try: “how many customers per country?” · “revenue by month this year” · “top customers by order count with
              their emails” (spans both services)
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i}>
              <div className="text-[14px] font-medium mb-2">
                <span style={{ color: "var(--primary)" }}>›</span> {t.question}
              </div>
              {t.running && (
                <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
                  Claude is writing SQL…
                </p>
              )}
              {t.plan && (
                <>
                  <p className="text-[13px] mb-2" style={{ color: "var(--muted-foreground)" }}>
                    {t.plan.explanation}
                  </p>
                  <div className="panel px-4 py-3 mb-2">
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <span className="tag" style={{ color: "var(--info)" }}>
                        {t.plan.target === "federated" ? "federated · duckdb" : "single · postgres"}
                      </span>
                      {t.plan.connections.map((c) => (
                        <span key={c} className="tag" style={{ color: "var(--success)" }}>
                          {c}
                        </span>
                      ))}
                      <span className="flex-1" />
                      <Button
                        variant="secondary"
                        size="sm"

                        onClick={() =>
                          setTurns((s) =>
                            s.map((x, j) => (j === i ? { ...x, editing: !x.editing, editedSql: x.plan!.sql } : x)),
                          )
                        }
                      >
                        {t.editing ? "Cancel edit" : "Edit SQL"}
                      </Button>
                    </div>
                    {t.editing ? (
                      <>
                        <Textarea
                          className="code w-full"
                          rows={6}
                          value={t.editedSql}
                          onChange={(e) =>
                            setTurns((s) => s.map((x, j) => (j === i ? { ...x, editedSql: e.target.value } : x)))
                          }
                        />
                        <Button size="sm" className="mt-2" onClick={() => rerun(i, t.editedSql!)}>
                          Run edited SQL
                        </Button>
                      </>
                    ) : (
                      <pre className="code whitespace-pre-wrap text-[12.5px]" style={{ color: "var(--foreground)" }}>
                        {t.plan.sql}
                      </pre>
                    )}
                  </div>
                </>
              )}
              {t.error && (
                <div
                  className="rounded-md border px-4 py-3 text-[13px] mb-2"
                  style={{
                    color: "var(--destructive)",
                    borderColor: "rgba(229,83,75,.4)",
                    background: "rgba(229,83,75,.06)",
                  }}
                >
                  <strong>
                    {t.error.includes("Forbidden") || t.error.includes("Only SELECT") ? "Blocked by SQL Guard: " : ""}
                  </strong>
                  {t.error}
                </div>
              )}
              {t.result && (
                <>
                  <ResultGrid result={t.result} />
                  <div className="flex gap-2 mt-2">
                    <Button variant="secondary" size="sm" onClick={() => saveQuery(t)}>
                      ☆ Save query
                    </Button>
                    {t.plan && (
                      <VisualizeButton
                        result={t.result}
                        source={{
                          target: t.plan.target,
                          connections: t.plan.connections,
                          sql: t.plan.sql,
                          dialect: t.plan.dialect,
                        }}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <aside
        className="w-64 shrink-0 border-l px-4 py-8 overflow-y-auto scrollbar-thin"
        style={{ background: "var(--card)" }}
      >
        <div
          className="text-[11px] font-semibold uppercase tracking-wider mb-2"
          style={{ color: "var(--muted-foreground-faint)" }}
        >
          Saved queries
        </div>
        {saved?.length === 0 && (
          <p className="text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
            Ask something, then hit “Save query”.
          </p>
        )}
        {saved?.map((sq) => (
          <div key={sq.id} className="panel px-3 py-2 mb-2">
            <Button variant="ghost" className="text-left text-[13px] font-medium w-full" onClick={() => runSaved(sq)}>
              {sq.name}
            </Button>
            {sq.nlPrompt && (
              <p
                className="text-[11.5px] mt-0.5 truncate"
                style={{ color: "var(--muted-foreground-faint)" }}
                title={sq.nlPrompt}
              >
                {sq.nlPrompt}
              </p>
            )}
            <div className="flex items-center gap-1 mt-1">
              <span className="tag" style={{ fontSize: 10 }}>
                {sq.target}
              </span>
              <span className="flex-1" />
              <Button
                variant="destructive"
                size="sm"

                style={{ padding: "0 6px", fontSize: 11 }}
                onClick={async () => {
                  await fetch(`/api/saved-queries/${sq.id}`, { method: "DELETE" });
                  qc.invalidateQueries({ queryKey: ["saved-queries"] });
                }}
              >
                ✕
              </Button>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
