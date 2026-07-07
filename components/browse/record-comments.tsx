"use client";

// Phase 8.9 — per-record comments. Pure Lizard-side (no target-DB access);
// rendered on the record detail page.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { RecordComment } from "@/lib/types";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function RecordComments({
  connectionId,
  schema,
  table,
  pk,
}: {
  connectionId: string;
  schema: string;
  table: string;
  pk: Record<string, unknown>;
}) {
  const qc = useQueryClient();
  const { user, isAdmin } = useAuth();
  const [body, setBody] = useState("");
  const pkParam = JSON.stringify(pk);
  const key = ["comments", connectionId, schema, table, pkParam];

  const { data: comments } = useQuery<RecordComment[]>({
    queryKey: key,
    queryFn: async () => {
      const qs = new URLSearchParams({
        connectionId,
        schema,
        table,
        pk: pkParam,
      });
      const res = await fetch(`/api/comments?${qs}`);
      if (!res.ok) throw new Error("failed to load comments");
      return res.json();
    },
    enabled: Object.keys(pk).length > 0,
  });

  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, schema, table, pk, body }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/comments/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="panel p-4 min-w-0">
      <div className="text-[13.5px] font-semibold mb-3">Comments{comments?.length ? ` (${comments.length})` : ""}</div>

      <div className="space-y-3 mb-3">
        {comments?.length === 0 && (
          <p className="text-[13px]" style={{ color: "var(--muted-foreground-faint)" }}>
            No comments yet.
          </p>
        )}
        {comments?.map((c) => {
          const canDelete = c.authorId === user?.id || isAdmin;
          return (
            <div key={c.id} className="text-[13px]">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-medium">{c.authorName ?? "—"}</span>
                <span style={{ color: "var(--muted-foreground-faint)", fontSize: 11 }}>{c.createdAt}</span>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto"
                    style={{ color: "var(--muted-foreground-faint)" }}
                    title="Delete comment"
                    onClick={() => remove.mutate(c.id)}
                  >
                    ✕
                  </Button>
                )}
              </div>
              <div className="whitespace-pre-wrap wrap-break-word">{c.body}</div>
            </div>
          );
        })}
      </div>

      <Textarea rows={2} placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={!body.trim() || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}
