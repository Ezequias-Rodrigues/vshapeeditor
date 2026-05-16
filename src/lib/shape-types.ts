export const LINE_TYPES = ["M", "N", "O", "P", "Q"] as const;
export type LineType = (typeof LINE_TYPES)[number];

export type Point = { X: number; Y: number };

export type Line = {
  Id: string; // 4-char uppercase hex
  Type: LineType;
  Length: number; // world px
  Angle: number; // degrees, 0 = +x, 90 = +y (y-down)
  Start: Point; // computed from chain
  End: Point; // computed from chain
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
