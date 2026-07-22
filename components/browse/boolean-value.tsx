import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { toBoolean } from "@/lib/data/widgets";
import { cn } from "@/lib/utils";

// Single source of truth for "does this value render as a boolean" — a real
// JS boolean, or MySQL's tinyint(1) (normalized to the "toggle" widget),
// which comes back as a raw 0/1/string rather than a real boolean. Every
// call site that needs to detect this (formatCell, the record detail page)
// should check via this instead of re-deriving `widget === "toggle" ||
// typeof value === "boolean"` independently.
export function isBooleanField(widget: string | undefined, value: unknown): boolean {
  return widget === "toggle" || typeof value === "boolean";
}

// One component for every place a boolean value renders — grid cells,
// gallery/kanban cards, hover previews, the record detail page, and nested
// JSON values — so a future style change (icon color, Yes/No wording) only
// has one place to make it. `variant` only changes presentation.
export function BooleanValue({
  value,
  variant = "pill",
  className,
}: {
  value: unknown;
  // "icon": bare check/x — dense contexts (grid/card/hover-preview).
  // "pill": a Yes/No badge — the record detail page.
  // "tag": a muted "✓ true"/"✗ false" chip — nested JSON values, which have
  // no column/widget context of their own.
  variant?: "icon" | "pill" | "tag";
  className?: string;
}) {
  const truthy = typeof value === "boolean" ? value : toBoolean(value);
  const icon = truthy ? (
    <Check className="size-3.5 text-green-600 dark:text-green-500" />
  ) : (
    <X className="size-3.5 text-muted-foreground" />
  );

  // "tag" already spells out "true"/"false" in the label itself, so a hover
  // tooltip repeating it would be redundant — the other two variants show
  // Yes/No or a bare icon, so the tooltip is the one place the actual
  // true/false reads unambiguously.
  if (variant === "tag") {
    return (
      <span
        className={className ?? "tag"}
        style={{ color: truthy ? "var(--success)" : "var(--muted-foreground)", fontSize: 11 }}
      >
        {truthy ? "✓ true" : "✗ false"}
      </span>
    );
  }

  const content =
    variant === "pill" ? (
      <Badge variant="outline" className={cn("gap-1 w-13", { "border-success": truthy }, className)}>
        {icon}
        {truthy ? "Yes" : "No"}
      </Badge>
    ) : (
      icon
    );

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex">{content}</span>} />
      <TooltipContent>{truthy ? "true" : "false"}</TooltipContent>
    </Tooltip>
  );
}
