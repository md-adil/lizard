"use client";

// Kanban/Calendar used to render whatever page the Table view had already
// fetched, bucketed client-side. With one global LIMIT, a group (kanban
// column / calendar day) bigger than the page size crowded every other group
// out of the fetch entirely. This hook instead asks the server for a fair
// top-N per distinct group value (or per day) — see listGroupedRows in
// app/api/data/crud.ts. Calendar additionally scopes the query to the visible
// month; without that, grouping by day across the table's whole history
// would fetch perGroup rows for every day that ever occurred.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { dataApiUrl } from "./data-api";
import { CALENDAR_DAY_DISPLAY_LIMIT, type CalendarCursor } from "./table-views";
import type { ViewType } from "./view-types";
import type { FkLabels } from "@/lib/types";
import type { FilterCondition, Combinator } from "@/lib/data/filters";

export interface GroupedListResponse {
  rows: Record<string, unknown>[];
  groupCounts: Record<string, number>;
  fkLabels: FkLabels;
}

const KANBAN_PER_GROUP = 25;
// Calendar only ever shows CALENDAR_DAY_DISPLAY_LIMIT chips per day (plus a
// "+N more" built from the server's exact groupCounts) — no point fetching
// more rows than that per day.
const CALENDAR_PER_GROUP = CALENDAR_DAY_DISPLAY_LIMIT;
const KANBAN_MAX_GROUPS = 20;
const CALENDAR_MAX_GROUPS = 40;

export function useGroupedRows(args: {
  connection: string;
  schema: string | undefined;
  table: string;
  viewType: ViewType;
  groupBy: string | undefined; // active kanban group column
  dateField: string | undefined; // active calendar date column
  calendarCursor: CalendarCursor;
  sort?: string;
  sortDir?: "asc" | "desc";
  filters: FilterCondition[];
  combinator: Combinator;
  search: string;
  enabled: boolean;
}) {
  const isKanban = args.viewType === "kanban";
  const isCalendar = args.viewType === "calendar";
  const groupField = isKanban ? args.groupBy : isCalendar ? args.dateField : undefined;
  const groupKind: "value" | "day" = isCalendar ? "day" : "value";
  const perGroup = isCalendar ? CALENDAR_PER_GROUP : KANBAN_PER_GROUP;
  const maxGroups = isCalendar ? CALENDAR_MAX_GROUPS : KANBAN_MAX_GROUPS;

  const conditions: FilterCondition[] =
    isCalendar && args.dateField
      ? [
          ...args.filters,
          {
            column: args.dateField,
            op: "gte",
            value: new Date(args.calendarCursor.y, args.calendarCursor.m, 1).toISOString(),
          },
          {
            column: args.dateField,
            op: "lt",
            value: new Date(args.calendarCursor.y, args.calendarCursor.m + 1, 1).toISOString(),
          },
        ]
      : args.filters;

  return useQuery<GroupedListResponse>({
    queryKey: [
      "grouped-rows",
      args.connection,
      args.schema,
      args.table,
      groupField,
      groupKind,
      perGroup,
      maxGroups,
      args.sort,
      args.sortDir,
      conditions,
      args.search,
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({
        groupBy: groupField!,
        groupKind,
        perGroup: String(perGroup),
        maxGroups: String(maxGroups),
        ...(args.sort ? { sort: args.sort, sortDir: args.sortDir ?? "asc" } : {}),
        ...(conditions.length ? { filters: JSON.stringify(conditions), combinator: args.combinator } : {}),
        ...(args.search ? { search: args.search } : {}),
      });
      const res = await fetch(
        dataApiUrl({
          connection: args.connection,
          table: args.table,
          schema: args.schema,
          params: Object.fromEntries(qs),
        }),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load rows");
      return body;
    },
    placeholderData: keepPreviousData,
    enabled: args.enabled && !!groupField && (isKanban || isCalendar),
  });
}
