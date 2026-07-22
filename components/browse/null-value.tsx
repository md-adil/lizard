import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function NullValue({ children = "∅", className }: { children?: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="outline" className={cn("text-muted-foreground", className)}>
            {children}
          </Badge>
        }
      />
      <TooltipContent>null</TooltipContent>
    </Tooltip>
  );
}
