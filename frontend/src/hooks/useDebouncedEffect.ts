import { useEffect, useRef } from "react";

/** Runs `effect` after `delay` ms of no dependency changes. Skips first render. */
export function useDebouncedEffect(effect: () => void, deps: unknown[], delay: number) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(effect, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
