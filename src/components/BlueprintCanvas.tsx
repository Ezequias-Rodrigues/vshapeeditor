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
  showIds: boolean;
  onCursor?: (info: { world: Point; angleSnap: number | null; zoom: number }) => void;
  fitTrigger: number;
  resetViewTrigger: number;
};

type MarkerRect = { id: string; X: number; Y: number; w: number; h: number };

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
  showIds,
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
  const panningRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );
  const draggingRef = useRef<{ index: number; preDrag: ShapeState } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const markersRef = useRef<MarkerRect[]>([]);

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
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of pts) {
      if (p.X < minX) minX = p.X;
      if (p.Y < minY) minY = p.Y;
      if (p.X > maxX) maxX = p.X;
      if (p.Y > maxY) maxY = p.Y;
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
      return (
        !!e &&
        (e.tagName === "INPUT" ||
          e.tagName === "TEXTAREA" ||
          e.tagName === "SELECT" ||
          e.isContentEditable)
      );
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
    return { X: (sx - v.panX) / v.zoom, Y: (sy - v.panY) / v.zoom };
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

      // ID marker hit-test (screen space) — works in any mode
      for (const m of markersRef.current) {
        if (sx >= m.X && sx <= m.X + m.w && sy >= m.Y && sy <= m.Y + m.h) {
          store.dispatch({ type: "select", id: m.id });
          return;
        }
      }

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
          if (Math.hypot(p.X - world.X, p.Y - world.Y) <= vertHit) {
            draggingRef.current = { index: i, preDrag: store.state };
            return;
          }
        }
        // hit-test lines: pick the NEAREST within tolerance
        const nearest = findNearestLine(lines, world, lineHit);
        if (nearest) {
          store.dispatch({ type: "select", id: nearest.Id });
          return;
        }
        store.dispatch({ type: "select", id: null });
        return;
      }

      // place mode: commit ghost line
      if (store.state.closed) return;
      const start = lines.length === 0 ? { X: 0, Y: 0 } : lines[lines.length - 1].End;
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

      // hover line in edit mode (no dispatch — pure visual)
      if (mode === "edit" && !draggingRef.current) {
        const lineHit = LINE_HIT_PX / viewRef.current.zoom;
        const near = findNearestLine(store.state.lines, cursorRef.current, lineHit);
        hoveredIdRef.current = near?.Id ?? null;
      } else {
        hoveredIdRef.current = null;
      }

      // ghost angle for status
      if (onCursor) {
        let snap: number | null = null;
        if (mode === "place" && !store.state.closed && cursorRef.current) {
          const start =
            store.state.lines.length === 0
              ? { X: 0, Y: 0 }
              : store.state.lines[store.state.lines.length - 1].End;
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
        // commit one history entrY: the pre-drag state
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

    // Fill interior when closed
    if (closed && lines.length >= 3) {
      drawClosedFill(ctx, v, lines);
    }

    // Bounding box overlay
    if (showBounds && lines.length > 0) {
      drawBoundingBox(ctx, v, lines);
    }

    // Shape lines (with hover highlight)
    markersRef.current = [];
    drawLines(ctx, v, lines, selectedId, hoveredIdRef.current, showIds, markersRef.current);

    // Vertices in edit mode
    if (mode === "edit") {
      drawVertices(ctx, v, lines);
    }

    // Ghost line in place mode
    if (mode === "place" && !closed && cursorRef.current) {
      drawGhost(ctx, v, lines, cursorRef.current, length, lineType);
    }
  });

  const cursor = panningRef.current
    ? "grabbing"
    : spaceRef.current
      ? "grab"
      : mode === "edit"
        ? hoveredIdRef.current
          ? "pointer"
          : "default"
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
  const startX = Math.floor(-v.panX / v.zoom / step) * step;
  const endX = Math.ceil((w - v.panX) / v.zoom / step) * step;
  const startY = Math.floor(-v.panY / v.zoom / step) * step;
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
  return { X: p.X * v.zoom + v.panX, Y: p.Y * v.zoom + v.panY };
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  v: View,
  lines: Line[],
  selectedId: string | null,
  hoveredId: string | null,
  showIds: boolean,
  markers: MarkerRect[],
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const ln of lines) {
    const a = worldToScreen(ln.Start, v);
    const b = worldToScreen(ln.End, v);
    const isSel = ln.Id === selectedId;
    const isHov = !isSel && ln.Id === hoveredId;
    // hover/selection underglow
    if (isSel || isHov) {
      ctx.setLineDash([]);
      ctx.lineWidth = isSel ? 9 : 7;
      ctx.strokeStyle = isSel ? "rgba(255,215,106,0.35)" : "rgba(123,224,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(a.X, a.Y);
      ctx.lineTo(b.X, b.Y);
      ctx.stroke();
    }
    ctx.setLineDash(TYPE_DASH[ln.Type]);
    ctx.lineWidth = isSel ? 3.5 : isHov ? 3 : 2.5;
    ctx.strokeStyle = isSel ? "#ffd76a" : isHov ? "#d8f4ff" : "#ffffff";
    ctx.beginPath();
    ctx.moveTo(a.X, a.Y);
    ctx.lineTo(b.X, b.Y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!showIds) continue;

    // perpendicular red tick at midpoint + readable label
    const mx = (a.X + b.X) / 2;
    const my = (a.Y + b.Y) / 2;
    const dx = b.X - a.X;
    const dy = b.Y - a.Y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const tick = 9;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#FF773b";
    ctx.beginPath();
    ctx.moveTo(mx - px * tick, my - py * tick);
    ctx.lineTo(mx + px * tick, my + py * tick);
    ctx.stroke();

    const label = `${ln.Type}·${ln.Id}`;
    ctx.font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const tw = ctx.measureText(label).width;
    const padX = 6;
    const padY = 3;
    const boxW = tw + padX * 2;
    const boxH = 16;
    const offset = tick + 4;
    const cx = mx + px * (offset + boxH / 2);
    const cy = my + py * (offset + boxH / 2);
    const bx = cx - boxW / 2;
    const by = cy - boxH / 2;

    // rounded background
    const r = 4;
    ctx.fillStyle = "#aa3b3b";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + boxW - r, by);
    ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
    ctx.lineTo(bx + boxW, by + boxH - r);
    ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
    ctx.lineTo(bx + r, by + boxH);
    ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    void padY;

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy + 0.5);

    markers.push({ id: ln.Id, X: bx, Y: by, w: boxW, h: boxH });
  }
  ctx.setLineDash([]);
}

function drawClosedFill(ctx: CanvasRenderingContext2D, v: View, lines: Line[]) {
  ctx.beginPath();
  const first = worldToScreen(lines[0].Start, v);
  ctx.moveTo(first.X, first.Y);
  for (const ln of lines) {
    const e = worldToScreen(ln.End, v);
    ctx.lineTo(e.X, e.Y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill("evenodd");
}

function drawBoundingBox(ctx: CanvasRenderingContext2D, v: View, lines: Line[]) {
  const bb = boundingBox(lines);
  const a = worldToScreen(bb.min, v);
  const b = worldToScreen(bb.max, v);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,215,106,0.7)";
  ctx.strokeRect(a.X, a.Y, b.X - a.X, b.Y - a.Y);
  // size label
  ctx.setLineDash([]);
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "rgba(255,215,106,0.95)";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  const w = (bb.max.X - bb.min.X).toFixed(1);
  const h = (bb.max.Y - bb.min.Y).toFixed(1);
  ctx.fillText(`${w} × ${h}`, a.X, a.Y - 4);
  ctx.restore();
}

function findNearestLine(lines: Line[], world: Point, tolerance: number): Line | null {
  let best: Line | null = null;
  let bestD = tolerance;
  for (const ln of lines) {
    const d = pointSegDistance(world, ln.Start, ln.End);
    if (d <= bestD) {
      bestD = d;
      best = ln;
    }
  }
  return best;
}

function drawVertices(ctx: CanvasRenderingContext2D, v: View, lines: Line[]) {
  const verts = vertices(lines);
  for (let i = 0; i < verts.length; i++) {
    const p = worldToScreen(verts[i], v);
    ctx.beginPath();
    ctx.arc(p.X, p.Y, 5, 0, Math.PI * 2);
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
  const start = lines.length === 0 ? { X: 0, Y: 0 } : lines[lines.length - 1].End;
  const ang = snapAngle(angleBetween(start, cursor));
  const rad = (ang * Math.PI) / 180;
  const end = { X: start.X + length * Math.cos(rad), Y: start.Y + length * Math.sin(rad) };
  const a = worldToScreen(start, v);
  const b = worldToScreen(end, v);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.X, a.Y);
  ctx.lineTo(b.X, b.Y);
  ctx.stroke();
  ctx.setLineDash([]);
  // endpoint marker
  ctx.beginPath();
  ctx.arc(b.X, b.Y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  // angle/length label
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${type} · ${length.toFixed(0)}px · ${ang}°`, b.X + 8, b.Y + 8);
}

// keep import to avoid tree-shake noise
void recomputeChain;
