"use client";

// Thin top loading bar for an in-place refetch (as opposed to the initial
// load, which renders its own skeleton/spinner). Shared by DataGrid and the
// table page's non-grid views (kanban/gallery/calendar/tree) so a refetch is
// visible no matter which view type is active — mount inside a `position:
// relative` ancestor spanning the view area.
import { useEffect, useRef } from "react";
import LoadingBar, { type LoadingBarRef } from "react-top-loading-bar";

export function RefetchBar({ isFetching, isLoading }: { isFetching: boolean; isLoading: boolean }) {
  const active = isFetching && !isLoading;
  const ref = useRef<LoadingBarRef>(null);

  useEffect(() => {
    if (active) ref.current?.continuousStart();
    else ref.current?.complete();
  }, [active]);

  return (
    <LoadingBar
      ref={ref}
      color="var(--primary)"
      height={2}
      shadow={false}
      containerStyle={{ position: "absolute", top: 0, left: 0, width: "100%", zIndex: 10 }}
    />
  );
}
