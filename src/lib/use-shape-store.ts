import { useCallback, useReducer, useRef } from "react";
import type { Line, LineType, Point, ShapeState } from "./shape-types";
import { initialShape } from "./shape-types";
import {
  angleBetween,
  distance,
  mirrorLines,
  nextHexId,
  recomputeChain,
  rotateLines,
} from "./geometry";

type HistoryState = {
  past: ShapeState[];
  present: ShapeState;
  future: ShapeState[];
};

type Action =
  | { type: "addLine"; length: number; angle: number; lineType: LineType }
  | { type: "deleteSelected" }
  | { type: "select"; id: string | null }
  | { type: "updateLine"; id: string; patch: Partial<Pick<Line, "length" | "angle" | "type">> }
  | { type: "moveVertex"; index: number; to: Point; snap: boolean }
  | { type: "closeShape"; lineType: LineType }
  | { type: "openShape" }
  | { type: "rotate"; deg: number }
  | { type: "mirror"; axis: "h" | "v" }
  | { type: "reset" }
  | { type: "load"; state: ShapeState }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 200;

function pushHistory(h: HistoryState, next: ShapeState): HistoryState {
  if (next === h.present) return h;
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

function usedIds(s: ShapeState): Set<string> {
  return new Set(s.lines.map((l) => l.id));
}

function reduce(state: ShapeState, action: Action): ShapeState {
  switch (action.type) {
    case "addLine": {
      if (state.closed) return state;
      const start =
        state.lines.length === 0
          ? { x: 0, y: 0 }
          : state.lines[state.lines.length - 1].end;
      const id = nextHexId(usedIds(state));
      const newLine: Line = {
        id,
        type: action.lineType,
        length: action.length,
        angle: action.angle,
        start,
        end: { x: 0, y: 0 },
      };
      const lines = recomputeChain([...state.lines, newLine], state.lines[0]?.start ?? { x: 0, y: 0 });
      return { ...state, lines };
    }
    case "deleteSelected": {
      if (!state.selectedId) return state;
      const idx = state.lines.findIndex((l) => l.id === state.selectedId);
      if (idx < 0) return state;
      const next = state.lines.filter((_, i) => i !== idx);
      const lines = recomputeChain(next, state.lines[0]?.start ?? { x: 0, y: 0 });
      return { ...state, lines, selectedId: null, closed: lines.length < 2 ? false : state.closed };
    }
    case "select":
      return { ...state, selectedId: action.id };
    case "updateLine": {
      const lines = recomputeChain(
        state.lines.map((l) => (l.id === action.id ? { ...l, ...action.patch } : l)),
        state.lines[0]?.start ?? { x: 0, y: 0 },
      );
      return { ...state, lines };
    }
    case "moveVertex": {
      // vertex index 0 = start of line 0 (origin). 1..N = end of line i-1.
      const { index, to, snap } = action;
      if (state.lines.length === 0) return state;
      if (index === 0) {
        // translate entire chain so first start = to
        const lines = recomputeChain(state.lines, to);
        return { ...state, lines };
      }
      const lineIdx = index - 1;
      const line = state.lines[lineIdx];
      const newLength = distance(line.start, to);
      let newAngle = angleBetween(line.start, to);
      if (snap) newAngle = Math.round(newAngle / 15) * 15;
      const updated = state.lines.map((l, i) =>
        i === lineIdx ? { ...l, length: newLength, angle: newAngle } : l,
      );
      const lines = recomputeChain(updated, state.lines[0]?.start ?? { x: 0, y: 0 });
      return { ...state, lines };
    }
    case "closeShape": {
      if (state.closed || state.lines.length < 2) return state;
      const last = state.lines[state.lines.length - 1].end;
      const first = state.lines[0].start;
      const length = distance(last, first);
      if (length < 1e-3) return { ...state, closed: true };
      const angle = angleBetween(last, first);
      const id = nextHexId(usedIds(state));
      const closing: Line = {
        id,
        type: action.lineType,
        length,
        angle,
        start: last,
        end: first,
      };
      return { ...state, lines: [...state.lines, closing], closed: true };
    }
    case "openShape":
      return { ...state, closed: false };
    case "rotate":
      return { ...state, lines: rotateLines(state.lines, action.deg) };
    case "mirror":
      return { ...state, lines: mirrorLines(state.lines, action.axis) };
    case "reset":
      return initialShape;
    case "load":
      return action.state;
    case "undo":
    case "redo":
      return state; // handled in wrapper
  }
}

export function useShapeStore() {
  const [hist, dispatch] = useReducer(
    (h: HistoryState, action: Action): HistoryState => {
      if (action.type === "undo") {
        if (h.past.length === 0) return h;
        const prev = h.past[h.past.length - 1];
        return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
      }
      if (action.type === "redo") {
        if (h.future.length === 0) return h;
        const [next, ...rest] = h.future;
        return { past: [...h.past, h.present], present: next, future: rest };
      }
      const next = reduce(h.present, action);
      // Selection-only changes shouldn't pollute history
      if (action.type === "select") return { ...h, present: next };
      return pushHistory(h, next);
    },
    { past: [], present: initialShape, future: [] },
  );

  // For drag operations we want a single history entry on mouseup.
  // We expose a "transient" applier that mutates present without pushing.
  const transientRef = useRef(false);
  const beginTransient = useCallback(() => {
    transientRef.current = true;
  }, []);
  const endTransient = useCallback(() => {
    transientRef.current = false;
  }, []);

  return {
    state: hist.present,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    dispatch,
    beginTransient,
    endTransient,
    transientRef,
  };
}

export type ShapeStore = ReturnType<typeof useShapeStore>;
