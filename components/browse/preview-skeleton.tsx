"use client";

// Shared loading placeholder for hover-preview popups (see
// ReferenceHoverPreview and CalendarEventPreview) — a title bar plus a
// handful of label/value rows, shaped like the field list it stands in for.
import { Skeleton } from "@/components/ui/skeleton";

export function PreviewSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3.5 w-2/3" />
      <div className="space-y-1.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
