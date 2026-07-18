import { useCallback, useRef, useState } from "react";

/** Undo/redo state container. Every `set` pushes onto the undo stack. */
export function useHistoryState<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial);
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  const [, bump] = useState(0);

  const set = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setPresent((prev) => {
        const next = typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
        if (next === prev) return prev;
        undoStack.current.push(prev);
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = [];
        bump((n) => n + 1);
        return next;
      });
    },
    [],
  );

  /** Replace present without recording history (e.g. loading from server). */
  const reset = useCallback((value: T) => {
    undoStack.current = [];
    redoStack.current = [];
    setPresent(value);
    bump((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    setPresent((prev) => {
      const last = undoStack.current.pop();
      if (last === undefined) return prev;
      redoStack.current.push(prev);
      bump((n) => n + 1);
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setPresent((prev) => {
      const next = redoStack.current.pop();
      if (next === undefined) return prev;
      undoStack.current.push(prev);
      bump((n) => n + 1);
      return next;
    });
  }, []);

  return {
    state: present,
    set,
    reset,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
