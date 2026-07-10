"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Check, Lock, TriangleAlert } from "lucide-react";
import { ConnectionForm, type ConnectionRow } from "@/app/settings/connection-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EngineIcon, ENGINE_LABELS } from "@/components/engine-icon";

interface ConnectionWithStatus extends ConnectionRow {
  status: { read: string | null; write: string | null };
}

// `error === null` means the credential probe succeeded.
function StatusBadge({ role, error }: { role: "read" | "write"; error: string | null }) {
  return error === null ? (
    <Badge variant="secondary" className="shrink-0 text-(--success)">
      <Check /> {role}
    </Badge>
  ) : (
    <Badge variant="destructive" className="shrink-0" title={error}>
      <TriangleAlert /> {role} failed
    </Badge>
  );
}

export function ConnectionsTab() {
  const qc = useQueryClient();
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<ConnectionRow | null>(null);
  const [removing, setRemoving] = useState<ConnectionRow | null>(null);

  const { data: connections, isLoading } = useQuery<ConnectionWithStatus[]>({
    queryKey: ["connections"],
    queryFn: async () => (await fetch("/api/connections")).json(),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/connections/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Connections</h2>
        <Button
          onClick={() => {
            setEditing(null);
            setFormMode("create");
          }}
        >
          + Add connection
        </Button>
      </div>
      <p className="text-[13px] mb-6" style={{ color: "var(--muted-foreground)" }}>
        Register each microservice&apos;s database (Postgres, MySQL, or MongoDB). Paste a connection URI or fill the
        fields, test it, then Lizard introspects every schema and makes the whole fleet browsable, editable, and
        queryable.
      </p>

      {isLoading && (
        <div className="space-y-3" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="px-5 py-4 flex-row items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-24 rounded-4xl" />
                  <Skeleton className="h-5 w-20 rounded-4xl" />
                </div>
                <Skeleton className="h-3 w-56 mt-2" />
              </div>
              <Skeleton className="h-8 w-14 shrink-0" />
              <Skeleton className="h-8 w-20 shrink-0" />
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {connections?.map((c) => {
          const failure = c.status.read ?? c.status.write;
          return (
            <Card key={c.id} className="px-5 py-4 gap-3 flex-row items-center flex-wrap sm:flex-nowrap">
              <Link
                href={`/browse/${c.name}`}
                className="flex-1 min-w-0 flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div
                  className="shrink-0 grid place-items-center size-10 rounded-lg border"
                  style={{ borderColor: "var(--border)", background: "var(--muted)" }}
                >
                  <EngineIcon engine={c.engine} className="size-6" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[14px] truncate">{c.name}</span>
                    <Badge variant="secondary" className="shrink-0">
                      {ENGINE_LABELS[c.engine]}
                    </Badge>
                    <StatusBadge role="read" error={c.status.read} />
                    {c.hasWrite ? (
                      <StatusBadge role="write" error={c.status.write} />
                    ) : (
                      <Badge variant="secondary" className="shrink-0">
                        read-only
                      </Badge>
                    )}
                    {c.ssl && (
                      <Badge variant="secondary" className="shrink-0">
                        <Lock /> SSL
                      </Badge>
                    )}
                  </div>
                  <div className="text-[12.5px] mt-1 code truncate" style={{ color: "var(--muted-foreground)" }}>
                    {c.host}:{c.port}/{c.database}
                  </div>
                  {/* Show the actual failure. Hiding it in a tooltip withholds the
                      one thing you need in order to fix it. */}
                  {failure && (
                    <p className="text-[11.5px] mt-1.5 line-clamp-2" style={{ color: "var(--destructive)" }}>
                      {failure}
                    </p>
                  )}
                </div>
              </Link>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditing(c);
                    setFormMode("edit");
                  }}
                >
                  Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setRemoving(c)}>
                  Remove
                </Button>
              </div>
            </Card>
          );
        })}
        {connections?.length === 0 && (
          <Card className="px-6 py-10 text-center">
            <p className="text-[14px] mb-1">No connections yet</p>
            <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              Add your first database to get a browsable console in seconds.
            </p>
          </Card>
        )}
      </div>

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &ldquo;{removing?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Lizard forgets this connection and the customizations saved against it. The database itself is never
              touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (removing) deleteMutation.mutate(removing.id);
                setRemoving(null);
              }}
            >
              {deleteMutation.isPending ? "Removing…" : "Remove connection"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConnectionForm
        mode={formMode}
        initial={editing ?? undefined}
        onClose={() => {
          setFormMode(null);
          setEditing(null);
        }}
      />
    </div>
  );
}
