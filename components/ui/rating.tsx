"use client";

import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RatingProps {
  value?: number;
  max?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

export function Rating({
  value = 0,
  max = 5,
  onChange,
  disabled = false,
  className,
  size = "md",
}: RatingProps) {
  const [hoverValue, setHoverValue] = React.useState<number | null>(null);

  const starSize = sizeClasses[size];

  return (
    <div
      data-slot="rating"
      className={cn(
        "flex items-center gap-1",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      {Array.from({ length: max }).map((_, idx) => {
        const starValue = idx + 1;
        const active = hoverValue !== null ? starValue <= hoverValue : starValue <= value;

        return (
          <button
            key={idx}
            type="button"
            disabled={disabled}
            className={cn(
              "text-muted-foreground outline-none transition-transform active:scale-95 duration-75",
              !disabled && "hover:scale-110 cursor-pointer"
            )}
            onClick={() => onChange?.(starValue)}
            onMouseEnter={() => !disabled && setHoverValue(starValue)}
            onMouseLeave={() => !disabled && setHoverValue(null)}
          >
            <Star
              className={cn(
                starSize,
                active ? "fill-amber-400 text-amber-400" : "text-muted/40"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
