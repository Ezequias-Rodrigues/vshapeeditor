export const LINE_TYPES = ["M", "N", "O", "P", "Q"] as const;
export type LineType = (typeof LINE_TYPES)[number];

export type Point = { x: number; y: number };

export type Line = {
  id: string;            // 4-char uppercase hex
  type: LineType;
  length: number;        // world px
  angle: number;         // degrees, 0 = +x, 90 = +y (y-down)
  start: Point;          // computed from chain
  end: Point;            // computed from chain
};

export type ShapeState = {
  lines: Line[];
  closed: boolean;
  selectedId: string | null;
};

export const initialShape: ShapeState = {
  lines: [],
  closed: false,
  selectedId: null,
};
