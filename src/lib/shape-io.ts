import { z } from "zod";
import type { ShapeState } from "./shape-types";
import { LINE_TYPES } from "./shape-types";
import { boundingBox, recomputeChain, shoelaceArea, vertices } from "./geometry";

const PointSchema = z.object({ x: z.number(), y: z.number() });

const LineSchema = z.object({
  id: z.string().regex(/^[0-9A-Fa-f]{4}$/),
  type: z.enum(LINE_TYPES),
  length: z.number().finite(),
  angle: z.number().finite(),
  start: PointSchema,
  end: PointSchema,
  middle: PointSchema.optional(),
});

const FileSchema = z.object({
  version: z.literal(1),
  units: z.literal("px"),
  coordinateSystem: z.literal("y-down"),
  center: PointSchema,
  size: z.object({ width: z.number(), height: z.number() }),
  area: z.number(),
  closed: z.boolean(),
  lines: z.array(LineSchema),
});

export type ShapeFile = z.infer<typeof FileSchema>;

export function serializeShape(state: ShapeState): ShapeFile {
  const lines = state.lines;
  const bb = boundingBox(lines);
  const center = {
    x: Math.round((bb.min.x + bb.max.x) / 2),
    y: Math.round((bb.min.y + bb.max.y) / 2),
  };
  const size = { width: Math.round(bb.max.x - bb.min.x), height: Math.round(bb.max.y - bb.min.y) };
 
  const area = shoelaceArea(lines, state.closed);
  return {
    version: 1,
    units: "px",
    coordinateSystem: "y-down",
    center,
    size,
    area,
    closed: state.closed,
    lines: lines.map((ln) => {
      const end = {x: Math.round(ln.end.x),y: Math.round(ln.end.y)}
      const start = {x: Math.round(ln.start.x),y: Math.round(ln.start.y)}
      return {
      id: ln.id.toUpperCase(),
      type: ln.type,
      length: ln.length,
      angle: ln.angle,
      start: start,
      end: end,
      middle: { x: Math.round((ln.start.x + ln.end.x) / 2), y: Math.round((ln.start.y + ln.end.y) / 2) },
    }
  }),
  };
}

export function deserializeShape(json: unknown): ShapeState {
  const parsed = FileSchema.parse(json);
  // Re-derive start/end from length/angle to guarantee chain consistency.
  // Anchor on the first line's stored start so absolute positions are preserved.
  const origin = parsed.lines[0]?.start ?? { x: 0, y: 0 };
  const lines = recomputeChain(
    parsed.lines.map((l) => ({
      id: l.id.toUpperCase(),
      type: l.type,
      length: l.length,
      angle: l.angle,
      start: l.start,
      end: l.end,
    })),
    origin,
  );
  return { lines, closed: parsed.closed, selectedId: null };
}

export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export { vertices };
