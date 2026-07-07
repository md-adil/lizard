import { useEffect, useRef } from "react";

// Runs `callback` every `delayMs`, always calling the latest callback (via a
// ref) so callers don't need to memoize it. Pass `null` to pause — the timer
// is cleared and no calls happen while paused.
export function useInterval(callback: () => void, delayMs: number | null) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => savedCallback.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}
