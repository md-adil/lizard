import { getLocalCurrency } from "@/lib/data/widgets";

export interface CurrencyCellProps {
  value: unknown;
  className?: string;
}

export function CurrencyCell({ value, className }: CurrencyCellProps) {
  const amount = Number(value);
  if (value === null || value === undefined || isNaN(amount)) {
    return <span className="text-muted-foreground">{String(value ?? "∅")}</span>;
  }

  let formatted = String(value);
  try {
    const localCode = getLocalCurrency();
    formatted = new Intl.NumberFormat(typeof navigator !== "undefined" ? navigator.language : "en-US", {
      style: "currency",
      currency: localCode,
    }).format(amount);
  } catch {
    formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  }

  return <span className={className}>{formatted}</span>;
}
