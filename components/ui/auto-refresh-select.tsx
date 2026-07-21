"use client";

// Shared Grafana-style auto-refresh picker — every "how often should this
// view re-fetch itself" dropdown (table browsing, dashboards, …) renders
// through this instead of repeating the option list and select boilerplate.
import { RefreshCw } from "lucide-react";
import { DataSelect } from "@/components/ui/data-select";

export const AUTO_REFRESH_OPTIONS = [
  { value: 0, label: "off" },
  { value: 5000, label: "5s" },
  { value: 10000, label: "10s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "1m" },
  { value: 300000, label: "5m" },
] as const;

export function AutoRefreshSelect({
  value,
  onChange,
  size = "sm",
  className = "",
}: {
  value: number; // ms, 0 = off
  onChange: (ms: number) => void;
  size?: "sm" | "default";
  className?: string;
}) {
  const options = AUTO_REFRESH_OPTIONS as unknown as { value: number; label: string }[];
  const selected = options.find((o) => o.value === value) ?? options[0];
  return (
    <DataSelect
      items={options}
      value={selected}
      onChange={(o) => o && onChange(o.value)}
      getLabel={(o) => (
        <span className="flex items-center gap-1.5">
          <RefreshCw
            className="size-3.5"
            style={{ color: o.value ? "var(--primary)" : "var(--muted-foreground-faint)" }}
          />
          {o.label}
        </span>
      )}
      size={size}
      className={`${className} bg-card`}
    />
  );
}
