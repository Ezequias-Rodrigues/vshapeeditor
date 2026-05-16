import { z } from "zod";
import type { ShapeState } from "./shape-types";
import { LINE_TYPES } from "./shape-types";
import { boundingBox, recomputeChain, shoelaceArea, vertices } from "./geometry";

const PointSchema = z.object({ X: z.number(), Y: z.number() });

const LineSchema = z.object({
  Id: z.string().regex(/^[0-9A-Fa-f]{4}$/),
  Type: z.enum(LINE_TYPES),
  Length: z.number().finite(),
  Angle: z.number().finite(),
  Start: PointSchema,
  End: PointSchema,
  Middle: PointSchema.optional(),
});

const FileSchema = z.object({
  Version: z.literal(1),
  Units: z.literal("px"),
  CoordinateSystem: z.literal("y-down"),
  Center: PointSchema,
  Size: z.object({ X: z.number(), Y: z.number() }),
  Area: z.number(),
  Closed: z.boolean(),
  Lines: z.array(LineSchema),
});

export type ShapeFile = z.infer<typeof FileSchema>;

export function serializeShape(state: ShapeState): ShapeFile {
  const lines = state.lines;
  const bb = boundingBox(lines);
  const Center = {
    X: Math.round((bb.min.X + bb.max.X) / 2),
    Y: Math.round((bb.min.Y + bb.max.Y) / 2),
  };
  const Size = { X: Math.round(bb.max.X - bb.min.X), Y: Math.round(bb.max.Y - bb.min.Y) };

  const area = shoelaceArea(lines, state.closed);
  return {
    Version: 1,
    Units: "px",
    CoordinateSystem: "y-down",
    Center,
    Size,
    Area: Math.round(area),
    Closed: state.closed,
    Lines: lines.map((ln) => {
      const End = { X: Math.round(ln.End.X), Y: Math.round(ln.End.Y) };
      const Start = { X: Math.round(ln.Start.X), Y: Math.round(ln.Start.Y) };
      const Middle = {
        X: Math.round((ln.Start.X + ln.End.X) / 2) ?? 0,
        Y: Math.round((ln.Start.Y + ln.End.Y) / 2) ?? 0,
      };
      return {
        Id: ln.Id.toUpperCase(),
        Type: ln.Type,
        Length: ln.Length,
        Angle: ln.Angle,
        Start: Start,
        End: End,
        Middle: Middle,
      };
    }),
  };
}

export function deserializeShape(json: unknown): ShapeState {
  const parsed = FileSchema.parse(json);
  // Re-derive start/end from length/angle to guarantee chain consistency.
  // Anchor on the first line's stored start so absolute positions are preserved.
  const origin = parsed.Lines[0]?.Start ?? { X: 0, Y: 0 };
  const lines = recomputeChain(
    parsed.Lines.map((l) => ({
      Id: l.Id.toUpperCase(),
      Type: l.Type,
      Length: l.Length,
      Angle: l.Angle,
      Start: l.Start,
      End: l.End,
    })),
    origin,
  );
  return { lines, closed: parsed.Closed, selectedId: null };
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
