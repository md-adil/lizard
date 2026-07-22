import * as React from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export interface AvatarCellProps {
  value: unknown;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function AvatarCell({ value, className, size = "sm" }: AvatarCellProps) {
  const text = String(value || "").trim();

  // Map size prop: sm -> sm, md -> default, lg -> lg
  const mappedSize = size === "md" ? "default" : size;

  if (!text) {
    return (
      <Avatar size={mappedSize} className={className}>
        <AvatarFallback>👤</AvatarFallback>
      </Avatar>
    );
  }

  const isUrl = text.startsWith("http://") || text.startsWith("https://") || text.startsWith("/");

  if (isUrl) {
    return (
      <Avatar size={mappedSize} className={className}>
        <AvatarImage src={text} alt="Avatar" />
        <AvatarFallback>👤</AvatarFallback>
      </Avatar>
    );
  }

  const initials =
    text
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "👤";

  return (
    <Avatar size={mappedSize} className={className}>
      <AvatarFallback className="bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
    </Avatar>
  );
}
