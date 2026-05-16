import type { Line, Point, ShapeState } from "./shape-types";

export const DEG = Math.PI / 180;

export function snapAngle(deg: number, step = 15): number {
  return Math.round(deg / step) * step;
}

export function polarEnd(start: Point, length: number, angleDeg: number): Point {
  return {
    X: start.X + length * Math.cos(angleDeg * DEG),
    Y: start.Y + length * Math.sin(angleDeg * DEG),
  };
}

export function angleBetween(a: Point, b: Point): number {
  return Math.atan2(b.Y - a.Y, b.X - a.X) / DEG;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.X - a.X, b.Y - a.Y);
}

/** Recompute every line's start/end from its length+angle, anchored at origin. */
export function recomputeChain(lines: Line[], origin: Point = { X: 0, Y: 0 }): Line[] {
  const out: Line[] = [];
  let cur = origin;
  for (const ln of lines) {
    const start = cur;
    const end = polarEnd(start, ln.Length, ln.Angle);
    out.push({ ...ln, Start: start, End: end });
    cur = end;
  }
  return out;
}

export function nextHexId(used: Set<string>): string {
  for (let n = 0; n < 0x10000; n++) {
    const id = n.toString(16).toUpperCase().padStart(4, "0");
    if (!used.has(id)) return id;
  }
  throw new Error("Out of IDs");
}

export function vertices(lines: Line[]): Point[] {
  if (lines.length === 0) return [];
  const pts: Point[] = [lines[0].Start];
  for (const ln of lines) pts.push(ln.End);
  return pts;
}

export function boundingBox(lines: Line[]): { min: Point; max: Point } {
  const pts = vertices(lines);
  if (pts.length === 0) return { min: { X: 0, Y: 0 }, max: { X: 0, Y: 0 } };
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
  return { min: { X: minX, Y: minY }, max: { X: maxX, Y: maxY } };
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
    s += a.X * b.Y - b.X * a.Y;
  }
  return Math.abs(s) / 2;
}

export function pointsEqual(a: Point, b: Point, eps = 1e-6): boolean {
  return Math.abs(a.X - b.X) < eps && Math.abs(a.Y - b.Y) < eps;
}

/** Distance from point p to segment a-b. */
export function pointSegDistance(p: Point, a: Point, b: Point): number {
  const dx = b.X - a.X;
  const dy = b.Y - a.Y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  let t = ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { X: a.X + t * dx, Y: a.Y + t * dy });
}

/** Rotate every line's angle and the origin (around origin point). */
export function rotateLines(lines: Line[], deg: number): Line[] {
  if (lines.length === 0) return lines;
  // rotate the first start around (0,0) too — it's already (0,0) in our chain
  const newLines = lines.map((ln) => ({ ...ln, Angle: ln.Angle + deg }));
  return recomputeChain(newLines, lines[0].Start);
}

/** Mirror across an axis: "h" mirrors X (flip horizontal), "v" mirrors Y. */
export function mirrorLines(lines: Line[], axis: "h" | "v"): Line[] {
  if (lines.length === 0) return lines;
  // Mirror is reflection. For each line angle:
  //  horizontal mirror (across vertical axis x=0): (x,y) -> (-x, y); angle -> 180 - angle
  //  vertical   mirror (across horizontal axis y=0): (x,y) -> (x, -y); angle -> -angle
  const newLines = lines.map((ln) => ({
    ...ln,
    Angle: axis === "h" ? 180 - ln.Angle : -ln.Angle,
  }));
  const origin = lines[0].Start;
  const newOrigin = axis === "h" ? { X: -origin.X, Y: origin.Y } : { X: origin.X, Y: -origin.Y };
  return recomputeChain(newLines, newOrigin);
}

/** Robust segment intersection test (returns true if open segments cross strictly). */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d = (p: Point, q: Point, r: Point) => (q.X - p.X) * (r.Y - p.Y) - (q.Y - p.Y) * (r.X - p.X);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  return false;
}

/** Validate a (possibly closed) chain of lines. Returns list of issues. */
export function validateShape(lines: Line[], closed: boolean): string[] {
  const issues: string[] = [];
  if (lines.length === 0) return issues;
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i].Length > 0)) issues.push(`Line ${lines[i].Id} has zero length`);
  }
  // chain continuity (defensive: recomputeChain enforces this, but check anyway)
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1].End;
    const cur = lines[i].Start;
    if (Math.hypot(prev.X - cur.X, prev.Y - cur.Y) > 1e-3) {
      issues.push(`Chain break before line ${lines[i].Id}`);
    }
  }
  // self-intersection: pairs of non-adjacent segments
  const n = lines.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      // skip adjacent (share endpoint); when closed, also skip last vs first
      if (closed && i === 0 && j === n - 1) continue;
      if (segmentsIntersect(lines[i].Start, lines[i].End, lines[j].Start, lines[j].End)) {
        issues.push(`Lines ${lines[i].Id} and ${lines[j].Id} cross`);
      }
    }
  }
  if (closed && lines.length >= 3) {
    const first = lines[0].Start;
    const last = lines[lines.length - 1].End;
    if (Math.hypot(first.X - last.X, first.Y - last.Y) > 1e-3) {
      issues.push("Shape marked closed but last vertex doesn't meet first");
    }
  }
  return issues;
}
