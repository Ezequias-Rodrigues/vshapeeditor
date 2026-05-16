import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Line, LineType, Point, ShapeState } from "@/lib/shape-types";
import {
  angleBetween,
  boundingBox,
  pointSegDistance,
  recomputeChain,
  snapAngle,
  vertices,
} from "@/lib/geometry";
import type { ShapeStore } from "@/lib/use-shape-store";

export type Mode = "place" | "edit";

type View = { zoom: number; panX: number; panY: number };

type Props = {
  store: ShapeStore;
  mode: Mode;
  length: number;
  lineType: LineType;
  showBounds: boolean;
  onCursor?: (info: { world: Point; angleSnap: number | null; zoom: number }) => void;
  fitTrigger: number;
  resetViewTrigger: number;
};

const TYPE_DASH: Record<LineType, number[]> = {
  M: [],
  N: [10, 6],
  O: [2, 6],
  P: [14, 4, 2, 4],
  Q: [6, 4, 2, 4, 2, 4],
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const VERTEX_HIT_PX = 10;
const LINE_HIT_PX = 8;

export function BlueprintCanvas({
  store,
  mode,
  length,
  lineType,
  showBounds,
  onCursor,
  fitTrigger,
  resetViewTrigger,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const cursorRef = useRef<Point | null>(null);
  const spaceRef = useRef(false);
  const shiftRef = useRef(false);
  const panningRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const draggingRef = useRef<{ index: number; preDrag: ShapeState } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const [, force] = useState(0);
  const requestRedraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      force((n) => (n + 1) & 0xffff);
    });
  }, []);

  // Resize observer
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const initial = sizeRef.current.w === 0;
      sizeRef.current = { w: r.width, h: r.height };
      canvas.width = Math.floor(r.width * dpr);
      canvas.height = Math.floor(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      if (initial) {
        // center origin on first mount
        viewRef.current = { zoom: 1, panX: r.width / 2, panY: r.height / 2 };
      }
      requestRedraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [requestRedraw]);

  // Reset / fit triggers
  useEffect(() => {
    const { w, h } = sizeRef.current;
    if (!w) return;
    viewRef.current = { zoom: 1, panX: w / 2, panY: h / 2 };
    requestRedraw();
  }, [resetViewTrigger, requestRedraw]);

  useEffect(() => {
    const lines = store.state.lines;
    const { w, h } = sizeRef.current;
    if (!w || lines.length === 0) return;
    const pts = vertices(lines);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = 60;
    const sw = Math.max(1, maxX - minX);
    const sh = Math.max(1, maxY - minY);
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((w - pad * 2) / sw, (h - pad * 2) / sh)),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    viewRef.current = { zoom, panX: w / 2 - cx * zoom, panY: h / 2 - cy * zoom };
    requestRedraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTrigger]);

  // Keyboard: space, shift, undo/redo, delete, esc, tab, 0, F
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      const e = el as HTMLElement | null;
      return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isEditable(e.target)) {
        spaceRef.current = true;
        e.preventDefault();
      }
      if (e.key === "Shift") shiftRef.current = true;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) store.dispatch({ type: "redo" });
        else store.dispatch({ type: "undo" });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        store.dispatch({ type: "redo" });
      } else if ((e.key === "Delete" || e.key === "Backspace") && !isEditable(e.target)) {
        if (mode === "edit" && store.state.selectedId) {
          e.preventDefault();
          store.dispatch({ type: "deleteSelected" });
        }
      } else if (e.key === "Escape") {
        store.dispatch({ type: "select", id: null });
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
      if (e.key === "Shift") shiftRef.current = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [mode, store]);

  const screenToWorld = useCallback((sx: number, sy: number): Point => {
    const v = viewRef.current;
    return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      // keep world point under cursor stationary
      const wx = (sx - v.panX) / v.zoom;
      const wy = (sy - v.panY) / v.zoom;
      viewRef.current = {
        zoom: newZoom,
        panX: sx - wx * newZoom,
        panY: sy - wy * newZoom,
      };
      requestRedraw();
    },
    [requestRedraw],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Pan: middle mouse, or space+left
      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        e.preventDefault();
        const v = viewRef.current;
        panningRef.current = { startX: sx, startY: sy, panX: v.panX, panY: v.panY };
        return;
      }
      if (e.button !== 0) return;

      const world = screenToWorld(sx, sy);
      const lines = store.state.lines;
      const v = viewRef.current;
      const vertHit = VERTEX_HIT_PX / v.zoom;
      const lineHit = LINE_HIT_PX / v.zoom;

      if (mode === "edit") {
        // hit-test vertices first
        const verts = vertices(lines);
        for (let i = 0; i < verts.length; i++) {
          const p = verts[i];
          if (Math.hypot(p.x - world.x, p.y - world.y) <= vertHit) {
            draggingRef.current = { index: i, preDrag: store.state };
            return;
          }
        }
        // hit-test lines: pick the NEAREST within tolerance
        const nearest = findNearestLine(lines, world, lineHit);
        if (nearest) {
          store.dispatch({ type: "select", id: nearest.id });
          return;
        }
        store.dispatch({ type: "select", id: null });
        return;
      }

      // place mode: commit ghost line
      if (store.state.closed) return;
      const start =
        lines.length === 0 ? { x: 0, y: 0 } : lines[lines.length - 1].end;
      const ang = snapAngle(angleBetween(start, world));
      store.dispatch({ type: "addLine", length, angle: ang, lineType });
    },
    [length, lineType, mode, screenToWorld, store],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      cursorRef.current = screenToWorld(sx, sy);

      if (panningRef.current) {
        const p = panningRef.current;
        viewRef.current = {
          zoom: viewRef.current.zoom,
          panX: p.panX + (sx - p.startX),
          panY: p.panY + (sy - p.startY),
        };
        requestRedraw();
        return;
      }

      if (draggingRef.current) {
        const { index } = draggingRef.current;
        store.dispatch({
          type: "moveVertex",
          index,
          to: cursorRef.current,
          snap: shiftRef.current,
          transient: true,
        });
        // don't requestRedraw — store dispatch causes re-render
      }

      // ghost angle for status
      if (onCursor) {
        let snap: number | null = null;
        if (mode === "place" && !store.state.closed && cursorRef.current) {
          const start =
            store.state.lines.length === 0
              ? { x: 0, y: 0 }
              : store.state.lines[store.state.lines.length - 1].end;
          snap = snapAngle(angleBetween(start, cursorRef.current));
        }
        onCursor({ world: cursorRef.current, angleSnap: snap, zoom: viewRef.current.zoom });
      }
      requestRedraw();
    },
    [mode, onCursor, requestRedraw, screenToWorld, store],
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      void e;
      if (panningRef.current) {
        panningRef.current = null;
        return;
      }
      if (draggingRef.current) {
        const { preDrag } = draggingRef.current;
        draggingRef.current = null;
        // commit one history entry: the pre-drag state
        if (preDrag !== store.state) {
          store.dispatch({ type: "commitSnapshot", snapshot: preDrag });
        }
      }
    },
    [store],
  );

  const onMouseLeave = useCallback(() => {
    cursorRef.current = null;
    requestRedraw();
  }, [requestRedraw]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = sizeRef.current;
    if (!w) return;
    const v = viewRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Background
    ctx.fillStyle = "#0e3a6b"; // blueprint blue
    ctx.fillRect(0, 0, w, h);

    // Grid (32-world-unit squares, every 4th heavier)
    drawGrid(ctx, w, h, v);

    // Origin crosshair
    drawOriginMark(ctx, v);

    // Shape lines
    const { lines, selectedId, closed } = store.state;
    drawLines(ctx, v, lines, selectedId);

    // Vertices in edit mode
    if (mode === "edit") {
      drawVertices(ctx, v, lines);
    }

    // Ghost line in place mode
    if (mode === "place" && !closed && cursorRef.current) {
      drawGhost(ctx, v, lines, cursorRef.current, length, lineType);
    }

    // closed indicator
    if (closed && lines.length >= 3) {
      // already drawn as last segment
    }
  });

  const cursor =
    panningRef.current
      ? "grabbing"
      : spaceRef.current
        ? "grab"
        : mode === "edit"
          ? "default"
          : "crosshair";

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor, display: "block", touchAction: "none" }}
      />
    </div>
  );
}

// ---- drawing helpers ----

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, v: View) {
  const step = 32; // world units
  const startX = Math.floor((-v.panX) / v.zoom / step) * step;
  const endX = Math.ceil((w - v.panX) / v.zoom / step) * step;
  const startY = Math.floor((-v.panY) / v.zoom / step) * step;
  const endY = Math.ceil((h - v.panY) / v.zoom / step) * step;

  ctx.lineWidth = 1;
  for (let wx = startX; wx <= endX; wx += step) {
    const sx = wx * v.zoom + v.panX;
    const major = Math.round(wx / step) % 4 === 0;
    ctx.strokeStyle = major ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.moveTo(sx + 0.5, 0);
    ctx.lineTo(sx + 0.5, h);
    ctx.stroke();
  }
  for (let wy = startY; wy <= endY; wy += step) {
    const sy = wy * v.zoom + v.panY;
    const major = Math.round(wy / step) % 4 === 0;
    ctx.strokeStyle = major ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.moveTo(0, sy + 0.5);
    ctx.lineTo(w, sy + 0.5);
    ctx.stroke();
  }
}

function drawOriginMark(ctx: CanvasRenderingContext2D, v: View) {
  const x = v.panX;
  const y = v.panY;
  ctx.strokeStyle = "rgba(255,220,120,0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 8, y);
  ctx.lineTo(x + 8, y);
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x, y + 8);
  ctx.stroke();
}

function worldToScreen(p: Point, v: View): Point {
  return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
}

function drawLines(ctx: CanvasRenderingContext2D, v: View, lines: Line[], selectedId: string | null) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const ln of lines) {
    const a = worldToScreen(ln.start, v);
    const b = worldToScreen(ln.end, v);
    const isSel = ln.id === selectedId;
    ctx.setLineDash(TYPE_DASH[ln.type]);
    ctx.lineWidth = isSel ? 4 : 2.5;
    ctx.strokeStyle = isSel ? "#ffd76a" : "#ffffff";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // type label at midpoint
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    ctx.setLineDash([]);
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = isSel ? "#ffd76a" : "rgba(255,255,255,0.85)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${ln.type}·${ln.id}`, mx, my - 10);
  }
  ctx.setLineDash([]);
}

function drawVertices(ctx: CanvasRenderingContext2D, v: View, lines: Line[]) {
  const verts = vertices(lines);
  for (let i = 0; i < verts.length; i++) {
    const p = worldToScreen(verts[i], v);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? "#ffd76a" : "#7be0ff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#0e3a6b";
    ctx.stroke();
  }
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  v: View,
  lines: Line[],
  cursor: Point,
  length: number,
  type: LineType,
) {
  const start = lines.length === 0 ? { x: 0, y: 0 } : lines[lines.length - 1].end;
  const ang = snapAngle(angleBetween(start, cursor));
  const rad = (ang * Math.PI) / 180;
  const end = { x: start.x + length * Math.cos(rad), y: start.y + length * Math.sin(rad) };
  const a = worldToScreen(start, v);
  const b = worldToScreen(end, v);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // endpoint marker
  ctx.beginPath();
  ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  // angle/length label
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${type} · ${length.toFixed(0)}px · ${ang}°`, b.x + 8, b.y + 8);
}

// keep import to avoid tree-shake noise
void recomputeChain;
