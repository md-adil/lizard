"use client";

// Shared pieces for dashboard variables, used by both the live toolbar on
// the dashboard view (app/dashboards/[id]/page.tsx) and the definition
// editor on the dashboard settings page (app/dashboards/[id]/settings).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, subMinutes, subMonths, subYears, startOfYear, endOfYear } from "date-fns";
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
import { cn } from "@/lib/utils";

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
// Most presets are "from X to now" (just a `from` fn); "Last year" is a fixed
// prior calendar year, so it needs its own `to` as well rather than `now`.
interface DatePreset {
  label: string;
  from: (now: Date) => Date;
  to?: (now: Date) => Date;
}

// Shared month/year tier appended to both DATE_PRESETS and TIME_PRESETS, so
// "including year" ranges are available regardless of whether the variable
// includes time-of-day.
const YEAR_TIER: DatePreset[] = [
  { label: "Last 90 days", from: (now) => subDays(now, 89) },
  { label: "Last 6 months", from: (now) => subMonths(now, 6) },
  { label: "Last 12 months", from: (now) => subMonths(now, 12) },
  { label: "This year", from: (now) => startOfYear(now) },
  { label: "Last year", from: (now) => startOfYear(subYears(now, 1)), to: (now) => endOfYear(subYears(now, 1)) },
];

const DATE_PRESETS: DatePreset[] = [
  { label: "Today", from: (now) => now },
  { label: "Last 7 days", from: (now) => subDays(now, 6) },
  { label: "Last 30 days", from: (now) => subDays(now, 29) },
  ...YEAR_TIER,
];
const TIME_PRESETS: DatePreset[] = [
  { label: "Last 15 minutes", from: (now) => subMinutes(now, 15) },
  { label: "Last 30 minutes", from: (now) => subMinutes(now, 30) },
  { label: "Last 1 hour", from: (now) => subMinutes(now, 60) },
  { label: "Last 3 hours", from: (now) => subMinutes(now, 180) },
  { label: "Last 6 hours", from: (now) => subMinutes(now, 360) },
  { label: "Last 12 hours", from: (now) => subMinutes(now, 720) },
  { label: "Last 24 hours", from: (now) => subMinutes(now, 1440) },
  { label: "Last 7 days", from: (now) => subDays(now, 6) },
  { label: "Last 30 days", from: (now) => subDays(now, 29) },
  ...YEAR_TIER,
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

// Shared date-range picker — Grafana's own shape: a preset column on the
// left, two plain From/To fields (not a calendar grid — a full month grid
// is a lot of chrome for "type/pick a date") behind an Apply button on the
// right. includeTime adds a time-of-day input alongside each date field,
// same from/to fields either way (just "yyyy-MM-dd" vs "yyyy-MM-dd HH:mm").
//
// Editing the fields doesn't call onChange until "Apply" is pressed —
// otherwise every keystroke would re-run every panel on the dashboard mid-edit.
// Closing without applying discards the draft (re-opening reseeds it from
// the last-applied from/to).
export function DateRangeField({
  from,
  to,
  includeTime = false,
  onChange,
  triggerClassName,
}: {
  from: string;
  to: string;
  includeTime?: boolean;
  onChange: (patch: { from: string; to: string }) => void;
  // Merged onto the trigger button — lets a caller that's grouping this with
  // other controls (e.g. the dashboard header's button group) override its
  // rounding/border without reaching into the Popover internals.
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draftFromDate, setDraftFromDate] = useState("");
  const [draftFromTime, setDraftFromTime] = useState("");
  const [draftToDate, setDraftToDate] = useState("");
  const [draftToTime, setDraftToTime] = useState("");

  const openChange = (next: boolean) => {
    if (next) {
      const [fromDate, fromTime] = splitDateTime(from);
      const [toDate, toTime] = splitDateTime(to);
      setDraftFromDate(fromDate);
      setDraftFromTime(fromTime);
      setDraftToDate(toDate);
      setDraftToTime(toTime);
    }
    setOpen(next);
  };

  const apply = () => {
    const fromStr = draftFromDate ? (includeTime ? `${draftFromDate} ${draftFromTime || "00:00"}` : draftFromDate) : "";
    const toStr = draftToDate ? (includeTime ? `${draftToDate} ${draftToTime || "23:59"}` : draftToDate) : "";
    onChange({ from: fromStr, to: toStr });
    setOpen(false);
  };

  // A preset names a single deliberate range — unlike manual calendar
  // clicks, it commits immediately and closes rather than waiting for Apply.
  // Most presets run to "now"; a fixed-range preset (e.g. "Last year") pins
  // its own `to` instead.
  const applyPreset = (preset: DatePreset) => {
    const now = new Date();
    const presetFrom = preset.from(now);
    const presetTo = preset.to ? preset.to(now) : now;
    const fromStr = includeTime ? format(presetFrom, "yyyy-MM-dd HH:mm") : format(presetFrom, "yyyy-MM-dd");
    const toStr = includeTime ? format(presetTo, "yyyy-MM-dd HH:mm") : format(presetTo, "yyyy-MM-dd");
    onChange({ from: fromStr, to: toStr });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger
        render={
          <Button variant="secondary" size="sm" className={cn("justify-start gap-1.5", triggerClassName)}>
            <CalendarDays className="size-3.5" />
            {from && to ? `${from} – ${to}` : "Pick a range"}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div
            className="flex flex-col gap-0.5 p-2 w-40 shrink-0 max-h-80 overflow-y-auto scrollbar-thin"
            style={{ borderRight: "1px solid var(--border)" }}
          >
            {(includeTime ? TIME_PRESETS : DATE_PRESETS).map((p) => (
              <PresetButton key={p.label} label={p.label} onClick={() => applyPreset(p)} />
            ))}
          </div>
          <div className="flex flex-col gap-3 p-3 w-80">
            <div>
              <label className="label">From</label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  className="flex-1 min-w-0"
                  value={draftFromDate}
                  onChange={(e) => setDraftFromDate(e.target.value)}
                />
                {includeTime && (
                  <Input
                    type="time"
                    className="w-32 shrink-0"
                    value={draftFromTime}
                    disabled={!draftFromDate}
                    onChange={(e) => setDraftFromTime(e.target.value)}
                  />
                )}
              </div>
            </div>
            <div>
              <label className="label">To</label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  className="flex-1 min-w-0"
                  value={draftToDate}
                  onChange={(e) => setDraftToDate(e.target.value)}
                />
                {includeTime && (
                  <Input
                    type="time"
                    className="w-32 shrink-0"
                    value={draftToTime}
                    disabled={!draftToDate}
                    onChange={(e) => setDraftToTime(e.target.value)}
                  />
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={!draftFromDate || !draftToDate} onClick={apply}>
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
function TextVariableInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onChange(draft);
  };
  return (
    <Input
      className={cn("w-36 h-8", className)}
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
  className,
}: {
  variable: DashboardVariable;
  onChange: (patch: Partial<DashboardVariable>) => void;
  // Reaches the actual bordered control (button/input/trigger) — for a
  // caller visually grouping this with sibling controls (e.g. the dashboard
  // header's button group) to override rounding/borders.
  className?: string;
}) {
  if (variable.type === "text") {
    return <TextVariableInput value={variable.value} onChange={(value) => onChange({ value })} className={className} />;
  }
  if (variable.type === "daterange") {
    return (
      <DateRangeField
        from={variable.from}
        to={variable.to}
        includeTime={variable.includeTime}
        onChange={(patch) => onChange(patch)}
        triggerClassName={className}
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
        className={cn("w-36", className)}
      />
    );
  }
  return (
    <QueryBackedSelect
      source={variable.source}
      value={variable.value}
      onChange={(value) => onChange({ value })}
      className={className}
    />
  );
}

function QueryBackedSelect({
  source,
  value,
  onChange,
  className,
}: {
  source: Extract<DashboardVariable, { type: "select" }>["source"] & { kind: "query" };
  value: string;
  onChange: (value: string) => void;
  className?: string;
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
      className={cn("w-36", className)}
      loading={isLoading}
      placeholder={error ? "query failed" : "— select —"}
    />
  );
}
