import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function quoteIdentifier(str: string): string {
  return `"${str.replace(/"/g, '""')}"`;
}

export function quoteLiteral(str: string): string {
  return `'${str.replace(/'/g, "''")}'`;
}
