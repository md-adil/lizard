"use client";

import { useEffect, useRef, useState } from "react";
import type { FilterSet } from "@/lib/data/filters";

export interface GridState {
  page: number;
  sort: string | undefined;
  sortDir: "asc" | "desc";
  filterSet: FilterSet;
  search: string;
}

function defaultGridState(): GridState {
  return {
    page: 0,
    sort: undefined,
    sortDir: "asc",
    filterSet: { combinator: "and", conditions: [] },
    search: "",
  };
}

const cache = new Map<string, GridState>();

type Updater<T> = T | ((prev: T) => T);

export function useGridState(key: string) {
  const [state, setState] = useState<GridState>(() => cache.get(key) ?? defaultGridState());
  const lastKey = useRef(key);

  // the key can change without this component unmounting (e.g. picking a
  // different table while staying on this route) — re-hydrate from that
  // table's own cache slot instead of carrying over the previous one's state.
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setState(cache.get(key) ?? defaultGridState());
  }, [key]);

  useEffect(() => {
    cache.set(key, state);
  }, [key, state]);

  function makeSetter<K extends keyof GridState>(field: K) {
    return (value: Updater<GridState[K]>) => {
      setState((s) => ({
        ...s,
        [field]: typeof value === "function" ? (value as (prev: GridState[K]) => GridState[K])(s[field]) : value,
      }));
    };
  }

  return {
    ...state,
    setPage: makeSetter("page"),
    setSort: makeSetter("sort"),
    setSortDir: makeSetter("sortDir"),
    setFilterSet: makeSetter("filterSet"),
    setSearch: makeSetter("search"),
  };
}
