import { cn } from "@/lib/utils";

export interface PercentCellProps {
  value: unknown;
  className?: string;
}

export function PercentCell({ value, className }: PercentCellProps) {
  const num = Number(value);
  if (value === null || value === undefined || isNaN(num)) {
    return <span className="text-muted-foreground">{String(value ?? "∅")}</span>;
  }

  const pct = Math.min(100, Math.max(0, num));

  return (
    <div className={cn("flex items-center gap-2 w-28 min-w-0", className)}>
      <div className="flex-1 h-2 rounded bg-muted/85 overflow-hidden shrink-0 border border-black/[0.04]">
        <div className="h-full bg-primary rounded-l transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs shrink-0 font-medium">{num}%</span>
    </div>
  );
}
