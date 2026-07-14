"use client";

// Wraps a reference cell's rendered label so hovering it previews a few
// fields of the row it actually points at, instead of requiring a click
// through to the related table. The preview only fetches once the card is
// actually open — with hundreds of reference cells on a page, fetching every
// one eagerly would be its own N+1 problem.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPortal,
  PreviewCardPositioner,
  PreviewCardPopup,
} from "@/components/ui/preview-card";
import { useTableMeta, formatCell } from "./useTableMeta";
import { dataApiUrl } from "./data-api";
import { PreviewSkeleton } from "./preview-skeleton";

export interface ReferenceTarget {
  connection: string;
  schema: string | undefined;
  table: string;
  column: string;
}

const PREVIEW_FIELD_LIMIT = 5;

export function ReferenceHoverPreview({
  target,
  value,
  children,
}: {
  target: ReferenceTarget;
  value: unknown;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { meta } = useTableMeta(target.connection, target.schema, target.table);

  const { data, isLoading } = useQuery<Record<string, unknown> | null>({
    queryKey: ["ref-preview", target.connection, target.schema, target.table, target.column, String(value)],
    queryFn: async () => {
      const qs = new URLSearchParams({
        page: "0",
        pageSize: "1",
        filters: JSON.stringify([{ column: target.column, op: "eq", value: String(value) }]),
      });
      const res = await fetch(
        dataApiUrl({
          connection: target.connection,
          table: target.table,
          schema: target.schema,
          params: Object.fromEntries(qs),
        }),
      );
      if (!res.ok) return null;
      const body = await res.json();
      return body.rows?.[0] ?? null;
    },
    enabled: open && !!meta,
    staleTime: 30_000,
  });

  const previewCols = (meta?.columns ?? [])
    .filter((c) => !c.hidden && !c.hiddenInGrid && !c.redacted && c.col.name !== meta?.displayColumn)
    .slice(0, PREVIEW_FIELD_LIMIT);

  return (
    <PreviewCard open={open} onOpenChange={setOpen}>
      <PreviewCardTrigger render={<span className="inline" />}>{children}</PreviewCardTrigger>
      <PreviewCardPortal>
        <PreviewCardPositioner>
          <PreviewCardPopup>
            {isLoading ? (
              <PreviewSkeleton rows={PREVIEW_FIELD_LIMIT} />
            ) : !data ? (
              <p className="text-[12px] text-muted-foreground">Row not found.</p>
            ) : (
              <div className="space-y-1">
                <div className="mb-1.5 truncate text-[13px] font-semibold">
                  {meta?.displayColumn ? String(data[meta.displayColumn] ?? "—") : String(value)}
                </div>
                {previewCols.map((cm) => {
                  const v = data[cm.col.name];
                  if (v == null) return null;
                  const f = formatCell(v, cm.widget, cm.optionLabels);
                  return (
                    <div key={cm.col.name} className="flex min-w-0 gap-2 text-[12px]">
                      <span className="shrink-0 text-muted-foreground">{cm.label}</span>
                      <span className="truncate">{f.icon ?? f.text}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </PreviewCardPopup>
        </PreviewCardPositioner>
      </PreviewCardPortal>
    </PreviewCard>
  );
}
