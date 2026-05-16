import type { Line, Point, ShapeState } from "./shape-types";

export const DEG = Math.PI / 180;

export function snapAngle(deg: number, step = 15): number {
  return Math.round(deg / step) * step;
}

export function polarEnd(start: Point, length: number, angleDeg: number): Point {
  return {
    x: start.x + length * Math.cos(angleDeg * DEG),
    y: start.y + length * Math.sin(angleDeg * DEG),
  };
}

export function angleBetween(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x) / DEG;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Recompute every line's start/end from its length+angle, anchored at origin. */
export function recomputeChain(lines: Line[], origin: Point = { x: 0, y: 0 }): Line[] {
  const out: Line[] = [];
  let cur = origin;
  for (const ln of lines) {
    const start = cur;
    const end = polarEnd(start, ln.length, ln.angle);
    out.push({ ...ln, start, end });
    cur = end;
  }
  return out;
}

export function nextHexId(used: Set<string>): string {
  for (let i = 0; i < 1000; i++) {
    const n = Math.floor(Math.random() * 0x10000);
    const id = n.toString(16).toUpperCase().padStart(4, "0");
    if (!used.has(id)) return id;
  }
  // fallback: scan
  for (let n = 0; n < 0x10000; n++) {
    const id = n.toString(16).toUpperCase().padStart(4, "0");
    if (!used.has(id)) return id;
  }
  throw new Error("Out of IDs");
}

export function vertices(lines: Line[]): Point[] {
  if (lines.length === 0) return [];
  const pts: Point[] = [lines[0].start];
  for (const ln of lines) pts.push(ln.end);
  return pts;
}

export function boundingBox(lines: Line[]): { min: Point; max: Point } {
  const pts = vertices(lines);
  if (pts.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export function shoelaceArea(lines: Line[], closed: boolean): number {
  if (!closed || lines.length < 3) return 0;
  const pts = vertices(lines);
  // last vertex equals first when closed; drop duplicate if present
  const ring = pts.slice(0, pts.length - (pointsEqual(pts[0], pts[pts.length - 1]) ? 1 : 0));
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function pointsEqual(a: Point, b: Point, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

/** Distance from point p to segment a-b. */
export function pointSegDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Rotate every line's angle and the origin (around origin point). */
export function rotateLines(lines: Line[], deg: number): Line[] {
  if (lines.length === 0) return lines;
  // rotate the first start around (0,0) too — it's already (0,0) in our chain
  const newLines = lines.map((ln) => ({ ...ln, angle: ln.angle + deg }));
  return recomputeChain(newLines, lines[0].start);
}

/** Mirror across an axis: "h" mirrors X (flip horizontal), "v" mirrors Y. */
export function mirrorLines(lines: Line[], axis: "h" | "v"): Line[] {
  if (lines.length === 0) return lines;
  // Mirror is reflection. For each line angle:
  //  horizontal mirror (across vertical axis x=0): (x,y) -> (-x, y); angle -> 180 - angle
  //  vertical   mirror (across horizontal axis y=0): (x,y) -> (x, -y); angle -> -angle
  const newLines = lines.map((ln) => ({
    ...ln,
    angle: axis === "h" ? 180 - ln.angle : -ln.angle,
  }));
  const origin = lines[0].start;
  const newOrigin = axis === "h" ? { x: -origin.x, y: origin.y } : { x: origin.x, y: -origin.y };
  return recomputeChain(newLines, newOrigin);
}
