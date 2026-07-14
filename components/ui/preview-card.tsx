"use client";

// Hover-triggered popover for a lightweight preview — used for the reference
// column hover-preview in the data grid. Mirrors the combobox/dropdown-menu
// wrapper conventions in this file's siblings.
import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "@/lib/utils";

const PreviewCard = PreviewCardPrimitive.Root;

function PreviewCardTrigger({ ...props }: PreviewCardPrimitive.Trigger.Props) {
  return <PreviewCardPrimitive.Trigger data-slot="preview-card-trigger" {...props} />;
}

function PreviewCardPortal({ ...props }: PreviewCardPrimitive.Portal.Props) {
  return <PreviewCardPrimitive.Portal data-slot="preview-card-portal" {...props} />;
}

function PreviewCardPositioner({
  side = "bottom",
  align = "start",
  sideOffset = 8,
  className,
  ...props
}: PreviewCardPrimitive.Positioner.Props) {
  return (
    <PreviewCardPrimitive.Positioner
      data-slot="preview-card-positioner"
      side={side}
      align={align}
      sideOffset={sideOffset}
      className={cn("isolate z-50", className)}
      {...props}
    />
  );
}

function PreviewCardPopup({ className, ...props }: PreviewCardPrimitive.Popup.Props) {
  return (
    <PreviewCardPrimitive.Popup
      data-slot="preview-card-popup"
      className={cn(
        "w-72 max-w-[calc(100vw-2rem)] origin-(--transform-origin) rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className,
      )}
      {...props}
    />
  );
}

export { PreviewCard, PreviewCardTrigger, PreviewCardPortal, PreviewCardPositioner, PreviewCardPopup };
