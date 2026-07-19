"use client";

// Shared pieces for dashboard variables, used by both the live toolbar on
// the dashboard view (app/dashboards/[id]/page.tsx) and the definition
// editor on the dashboard settings page (app/dashboards/[id]/settings).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, subMinutes } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarDays } from "lucide-react";
import type { DashboardVariable, QueryResult, VariableOption } from "@/lib/types";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

// Drop-in replacement for DataSelect (same getValue/getLabel/placeholder
// prop shape) backed by Combobox instead of Select, so every variable-related
// dropdown is searchable — worth it once a connection/column/option list
// runs past a handful of entries. Operates on the item type T directly
// (rather than flattening to a value string and re-`.find()`-ing it), using
// base-ui's itemToStringValue/itemToStringLabel so the trigger shows the
// label while value/equality are still keyed by getValue.
export function SearchableSelect<T>({
  items,
  value,
  onChange,
  getValue = (item: T) => (item as { value: string }).value,
  getLabel = (item: T) => String((item as { label: unknown }).label),
  placeholder = "— select —",
  className,
  disabled,
  loading = false,
}: {
  items: T[];
  value: T | null;
  onChange: (item: T | null) => void;
  getValue?: (item: T) => string;
  getLabel?: (item: T) => string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(item) => onChange(item)}
      itemToStringValue={getValue}
      itemToStringLabel={getLabel}
      isItemEqualToValue={(a, b) => getValue(a) === getValue(b)}
      disabled={disabled || loading}
    >
      <ComboboxInput
        placeholder={loading ? "Loading…" : placeholder}
        className={className}
        disabled={disabled || loading}
      />
      <ComboboxContent>
        <ComboboxEmpty>No results</ComboboxEmpty>
        <ComboboxList>
          {(item: T) => (
            <ComboboxItem key={getValue(item)} value={item}>
              {getLabel(item)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// Builds {label,value} option pairs from a query result: valueField is
// substituted into SQL, labelField (defaulting to valueField) is just for
// display — e.g. valueField "id", labelField "name" for an id/name lookup
// table. Deduped by value, first label wins.
export function optionsFromResult(
  result: QueryResult,
  valueField: string | null,
  labelField: string | null,
): VariableOption[] {
  const valueCol = valueField ?? result.columns[0]?.name;
  const labelCol = labelField ?? valueCol;
  if (!valueCol) return [];
  const byValue = new Map<string, string>();
  for (const row of result.rows) {
    const value = String(row[valueCol]);
    if (!byValue.has(value)) byValue.set(value, labelCol ? String(row[labelCol]) : value);
  }
  return [...byValue].map(([value, label]) => ({ label, value }));
}

// "yyyy-MM-dd" or "yyyy-MM-dd HH:mm" → [datePart, timePart ("" if none)].
function splitDateTime(s: string): [string, string] {
  const [date, time] = s.split(" ");
  return [date ?? "", time ?? ""];
}

// Quick-pick shortcuts — day-granularity ranges when the variable is
// date-only, minute/hour-granularity "last N" ranges when it includes time
// (Grafana's quick-range convention). Each is a single deliberate choice, so
// unlike manual calendar clicks it commits immediately instead of staging.
const DATE_PRESETS = [
  { label: "Today", from: (now: Date) => now },
  { label: "Last 7 days", from: (now: Date) => subDays(now, 6) },
  { label: "Last 30 days", from: (now: Date) => subDays(now, 29) },
];
const TIME_PRESETS = [
  { label: "Last 15 minutes", from: (now: Date) => subMinutes(now, 15) },
  { label: "Last 30 minutes", from: (now: Date) => subMinutes(now, 30) },
  { label: "Last 1 hour", from: (now: Date) => subMinutes(now, 60) },
  { label: "Last 3 hours", from: (now: Date) => subMinutes(now, 180) },
  { label: "Last 6 hours", from: (now: Date) => subMinutes(now, 360) },
  { label: "Last 12 hours", from: (now: Date) => subMinutes(now, 720) },
  { label: "Last 24 hours", from: (now: Date) => subMinutes(now, 1440) },
];

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="text-left text-[12.5px] px-2.5 py-1.5 rounded-md transition-colors cursor-pointer hover:bg-accent"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

// Shared date-range picker (shadcn Calendar in range mode, behind a
// Popover) — used both by the live toolbar (daterange variable) and the
// variable creation/edit card. includeTime adds a from/to time-of-day
// alongside the calendar, same from/to fields either way (just
// "yyyy-MM-dd" vs. "yyyy-MM-dd HH:mm").
//
// Picking a range is several clicks (start day, end day, from time, to
// time) — calling onChange after every one of them would re-run every panel
// on the dashboard mid-pick. Instead this holds its own draft state and only
// calls onChange once, when "Apply" is pressed; closing without applying
// just discards the draft (re-opening reseeds it from the last-applied from/to).
export function DateRangeField({
  from,
  to,
  includeTime = false,
  onChange,
}: {
  from: string;
  to: string;
  includeTime?: boolean;
  onChange: (patch: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined);
  const [draftFromTime, setDraftFromTime] = useState("");
  const [draftToTime, setDraftToTime] = useState("");

  const openChange = (next: boolean) => {
    if (next) {
      const [fromDate, fromTime] = splitDateTime(from);
      const [toDate, toTime] = splitDateTime(to);
      setDraftRange({ from: fromDate ? new Date(fromDate) : undefined, to: toDate ? new Date(toDate) : undefined });
      setDraftFromTime(fromTime);
      setDraftToTime(toTime);
    }
    setOpen(next);
  };

  const apply = () => {
    const fromStr = draftRange?.from
      ? includeTime
        ? `${format(draftRange.from, "yyyy-MM-dd")} ${draftFromTime || "00:00"}`
        : format(draftRange.from, "yyyy-MM-dd")
      : "";
    const toStr = draftRange?.to
      ? includeTime
        ? `${format(draftRange.to, "yyyy-MM-dd")} ${draftToTime || "23:59"}`
        : format(draftRange.to, "yyyy-MM-dd")
      : "";
    onChange({ from: fromStr, to: toStr });
    setOpen(false);
  };

  // A preset names a single deliberate range — unlike manual calendar
  // clicks, it commits immediately and closes rather than waiting for Apply.
  const applyPreset = (presetFrom: Date) => {
    const now = new Date();
    const fromStr = includeTime ? format(presetFrom, "yyyy-MM-dd HH:mm") : format(presetFrom, "yyyy-MM-dd");
    const toStr = includeTime ? format(now, "yyyy-MM-dd HH:mm") : format(now, "yyyy-MM-dd");
    onChange({ from: fromStr, to: toStr });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger render={<Button variant="secondary" size="sm" className="justify-start gap-1.5" />}>
        <CalendarDays className="size-3.5" />
        {from && to ? `${from} – ${to}` : "Pick a range"}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div
            className="flex flex-col gap-0.5 p-2 w-40 shrink-0"
            style={{ borderRight: "1px solid var(--border)" }}
          >
            {(includeTime ? TIME_PRESETS : DATE_PRESETS).map((p) => (
              <PresetButton key={p.label} label={p.label} onClick={() => applyPreset(p.from(new Date()))} />
            ))}
          </div>
          <div className="flex flex-col">
            <Calendar mode="range" selected={draftRange} onSelect={setDraftRange} numberOfMonths={2} />
            {includeTime && (
              <div
                className="flex items-center justify-between gap-3 p-3 border-t"
                style={{ borderColor: "var(--border)" }}
              >
                <Input
                  type="time"
                  className="w-34"
                  value={draftFromTime}
                  disabled={!draftRange?.from}
                  onChange={(e) => setDraftFromTime(e.target.value)}
                />
                <span style={{ color: "var(--muted-foreground-faint)" }}>–</span>
                <Input
                  type="time"
                  className="w-34"
                  value={draftToTime}
                  disabled={!draftRange?.to}
                  onChange={(e) => setDraftToTime(e.target.value)}
                />
              </div>
            )}
            <div className="flex justify-end p-3 border-t" style={{ borderColor: "var(--border)" }}>
              <Button size="sm" disabled={!draftRange?.from || !draftRange?.to} onClick={apply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Commits on blur/Enter rather than on every keystroke — same reasoning as
// DateRangeField's Apply button, just via the more idiomatic gesture for a
// text field (matches the dashboard-name-rename input elsewhere in the app).
function TextVariableInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onChange(draft);
  };
  return (
    <Input
      className="w-36 h-8"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

// The live "pick a value" control shown in the dashboard toolbar — as
// opposed to VariableFormCard, which defines what the variable IS, this
// just lets a viewer change its current value.
export function VariableValueControl({
  variable,
  onChange,
}: {
  variable: DashboardVariable;
  onChange: (patch: Partial<DashboardVariable>) => void;
}) {
  if (variable.type === "text") {
    return <TextVariableInput value={variable.value} onChange={(value) => onChange({ value })} />;
  }
  if (variable.type === "daterange") {
    return (
      <DateRangeField
        from={variable.from}
        to={variable.to}
        includeTime={variable.includeTime}
        onChange={(patch) => onChange(patch)}
      />
    );
  }
  if (variable.source.kind === "static") {
    const options = variable.source.options;
    return (
      <SearchableSelect
        items={options}
        value={options.find((o) => o.value === variable.value) ?? null}
        onChange={(o) => onChange({ value: o?.value ?? "" })}
        className="w-36"
      />
    );
  }
  return (
    <QueryBackedSelect source={variable.source} value={variable.value} onChange={(value) => onChange({ value })} />
  );
}

function QueryBackedSelect({
  source,
  value,
  onChange,
}: {
  source: Extract<DashboardVariable, { type: "select" }>["source"] & { kind: "query" };
  value: string;
  onChange: (value: string) => void;
}) {
  const { data, isLoading, error } = useQuery<QueryResult>({
    queryKey: ["dashboard-var-options", source.sql, source.connections, source.dialect, source.target],
    queryFn: async () => {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: source.target,
          connections: source.connections,
          sql: source.sql,
          dialect: source.dialect,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "query failed");
      return body;
    },
    enabled: source.connections.length > 0 && !!source.sql.trim(),
    staleTime: 5 * 60_000,
  });
  const options = data ? optionsFromResult(data, source.valueField, source.labelField) : [];

  // Auto-pick the first option once loaded if nothing's selected yet — same
  // "don't make the user click twice" convenience as a plain select's first
  // value.
  useEffect(() => {
    if (!value && options.length > 0) onChange(options[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.map((o) => o.value).join(" ")]);

  return (
    <SearchableSelect
      items={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={(o) => onChange(o?.value ?? "")}
      className="w-36"
      loading={isLoading}
      placeholder={error ? "query failed" : "— select —"}
    />
  );
}
