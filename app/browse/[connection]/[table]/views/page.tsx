"use client";

// Dedicated management page for this table's saved views — listing +
// deleting lives here instead of inline "✕" buttons on every tab, so the
// tab row (components/browse/view-tabs.tsx) stays about switching views,
// not managing them. Reached via the small settings icon in that tab row.
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SavedView } from "@/lib/types";
import { useAuth } from "@/components/auth-context";
import { useTableMeta } from "@/components/browse/useTableMeta";
import { useSchemaParam, tableHref } from "@/components/browse/use-schema-param";
import { VIEW_LABELS, VIEW_ICONS, type ViewType } from "@/components/browse/view-types";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export default function TableViewsPage() {
  const params = useParams<{ connection: string; table: string }>();
  const schema = useSchemaParam();
  const { meta, isLoading: metaLoading } = useTableMeta(params.connection, schema, params.table);
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const key = ["views", meta?.connectionId, meta?.resolvedSchema, params.table];
  const { data: views, isLoading } = useQuery<SavedView[]>({
    queryKey: key,
    queryFn: async () => {
      const qs = new URLSearchParams({
        connectionId: meta!.connectionId,
        schema: meta!.resolvedSchema,
        table: params.table,
      });
      const res = await fetch(`/api/views?${qs}`);
      if (!res.ok) throw new Error("failed to load views");
      return res.json();
    },
    enabled: !!meta,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/views/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const backHref = tableHref({ connection: params.connection, schema: meta?.schema ?? schema, table: params.table });

  if (metaLoading || !meta) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: "Home", link: "/" },
          { label: params.connection, link: `/browse/${params.connection}` },
          { label: meta.label, link: backHref },
          { label: "Views" },
        ]}
      />
      <h1 className="text-lg font-semibold mb-5">Saved views</h1>

      {isLoading && <Skeleton className="h-32 w-full" />}
      {!isLoading && (!views || views.length === 0) && (
        <Card className="px-6 py-10 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          No saved views yet. Save one from the "+" button in {meta.label}'s view tabs.
        </Card>
      )}
      {!isLoading && views && views.length > 0 && (
        <div className="space-y-2">
          {views.map((v) => {
            const type = (v.config.viewType ?? "table") as ViewType;
            const Icon = VIEW_ICONS[type];
            const canDelete = v.ownerId === user?.id || isAdmin;
            return (
              <Card key={v.id} className="p-3 flex-row items-center gap-3">
                <Icon className="size-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{v.name}</div>
                  <div className="text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
                    {VIEW_LABELS[type]}
                    {v.config.search ? ` · search: "${v.config.search}"` : ""}
                    {v.config.sort ? ` · sort: ${v.config.sort} ${v.config.sortDir ?? "asc"}` : ""}
                  </div>
                </div>
                {canDelete && (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button variant="secondary" size="sm">
                          Delete
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete "{v.name}"?</AlertDialogTitle>
                        <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => remove.mutate(v.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
