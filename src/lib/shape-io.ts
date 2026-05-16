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
    x: (bb.min.x + bb.max.x) / 2,
    y: (bb.min.y + bb.max.y) / 2,
  };
  const size = { width: bb.max.x - bb.min.x, height: bb.max.y - bb.min.y };
  const area = shoelaceArea(lines, state.closed);
  return {
    version: 1,
    units: "px",
    coordinateSystem: "y-down",
    center,
    size,
    area,
    closed: state.closed,
    lines: lines.map((ln) => ({
      id: ln.id.toUpperCase(),
      type: ln.type,
      length: ln.length,
      angle: ln.angle,
      start: ln.start,
      end: ln.end,
    })),
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
