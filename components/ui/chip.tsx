"use client"

import * as React from "react"
import { X } from "lucide-react"
import type { VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { badgeVariants } from "./badge"

// A clickable/removable pill built on Badge's visual language. Badge itself
// is a single non-interactive element; Chip composes a label click-region and
// an optional inline remove affordance without nesting a second full Button
// inside it (which fights the pill's own padding/height).
function Chip({
  className,
  variant = "outline",
  active,
  onRemove,
  removeLabel = "Remove",
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof badgeVariants> & {
    active?: boolean
    onRemove?: () => void
    removeLabel?: string
  }) {
  return (
    <span
      data-slot="chip"
      data-active={active ? "" : undefined}
      className={cn(
        badgeVariants({ variant }),
        "gap-1 pr-1 has-[button:last-child:not(:first-child)]:pr-1",
        "data-[active]:border-accent/40 data-[active]:bg-accent/10 data-[active]:text-accent",
        className
      )}
    >
      <button
        type="button"
        className={cn(
          "max-w-32 truncate outline-none",
          onRemove ? "" : "pr-1"
        )}
        {...props}
      >
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          className="-mr-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground"
          title={removeLabel}
          aria-label={removeLabel}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

export { Chip }
