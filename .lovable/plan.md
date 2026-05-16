# Concave Shape Drawing Tool — Plan

A single-page app on `/` for building one shape per project out of connected line segments, with full export/reload of the geometry. Blueprint aesthetic.

## Visual style

- Canvas background: deep blueprint blue.
- Grid: white lines, 32×32 px squares (every 4th line slightly thicker for a major-grid feel).
- Origin crosshair highlighted.
- Lines drawn in white; per-type variation via dash pattern + small type label tag near the midpoint.
- Selected line glows (thicker stroke + accent color).
- Ghost (preview) line: dashed, semi-transparent white.

## Core behavior

**Canvas**

- Full-viewport HTML `<canvas>`. World origin (0,0) at shape start; rendered with a view transform (zoom + pan).
- **Pan**: middle-mouse drag, or `Space + left-drag`.
- **Zoom**: mouse wheel, zooming toward the cursor. Min 0.1×, max 10×. `0` key resets view, `F` fits shape to viewport.
- Grid always rendered in world space so the 32-px squares scale with zoom (blueprint feel preserved).
- Coordinates stored in **pixels, Y-down**, relative to the shape's own center on export.

**Placement mode (default)**

- Toolbar: **Line length** (numeric, remembered) and **Line type** (M/N/O/P/Q dropdown).
- Ghost line previews from the current end-point toward the cursor:
  - Length = length field value.
  - Angle = cursor angle, snapped to **15°** increments.
- **Left click** commits the ghost; its end becomes the next start.
- First line starts at (0,0). **Close shape** button adds a final segment from current end back to the first vertex.

**Edit mode**

- Click a line to select it. Sidebar shows `id`, `length`, `angle`, `type`, start/end.
- Editable numerically: `length`, `angle` (free, no snap in editor), `type`.
- **Vertex dragging**: each vertex shows a handle; drag to reposition. Dragging updates the two adjacent lines' length and angle (and propagates start-points down the chain). Hold `Shift` while dragging to snap the affected angle(s) to 15°.
- **Delete line**: removes it; the chain reconnects (next line starts where the deleted line started).
- Changing one line propagates down the chain (subsequent lines keep their own length/angle, so the tail shifts). Documented in the UI.

**Undo / Redo**

- History stack of shape states. Buttons + `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`. Vertex drags commit one history entry on mouse-up.

**Transforms (mutate stored data)**

- Rotate left 90°, rotate right 90°, rotate by custom degrees.
- Mirror horizontal, mirror vertical.
- Each rewrites every line's angle and recomputes start/end points so the saved file reflects the transform.

**IDs**

- 4-char uppercase hex (`0000`–`FFFF`), assigned on creation, unique per shape, preserved across edits/transforms/drags.

## File format (`.json`)

```json
{
  "version": 1,
  "units": "px",
  "coordinateSystem": "y-down",
  "center": { "x": 0, "y": 0 },
  "size": { "width": 0, "height": 0 },
  "area": 0,
  "closed": false,
  "lines": [
    {
      "id": "A1B2",
      "type": "M",
      "length": 120,
      "angle": 0,
      "start": { "x": 0, "y": 0 },
      "end": { "x": 120, "y": 0 }
    }
  ]
}
```

- `center`: centroid of the shape's bounding box (drawing space).
- `size`: bounding-box width/height.
- `area`: shoelace area (0 if not closed; UI warns).
- `start`/`end` redundant for external scripts; validated on reload.

**Save** = download JSON. **Load** = file picker; replaces current shape and clears history.

## UI layout

- Top toolbar: mode toggle (Place / Edit), length input, type dropdown, Close shape, Undo, Redo, Rotate L/R, Rotate custom, Mirror H/V, Save, Load, New.
- Right sidebar (Edit mode): selected line properties + Delete.
- Bottom status bar: cursor world coords, current zoom %, snap angle, vertex count, closed/open indicator.
- Floating zoom controls (− / % / + / Fit / Reset) bottom-right.

## Technical breakdown

- **Routes**: single `src/routes/index.tsx`. Fully client-side.
- **State**: `useReducer` shape store `{ lines, closed, selectedId }` + separate history stack. View transform `{ zoom, panX, panY }` kept in a ref to avoid re-renders during pan/zoom.
- **Rendering**: `<canvas>` redrawn on state or view change via `requestAnimationFrame`. Per-type stroke style (dash pattern + label).
- **Geometry** (`src/lib/geometry.ts`): `snapAngle`, `polarToCartesian`, `rotatePoint`, `mirrorPoint`, `boundingBox`, `centroid`, `shoelaceArea`, `recomputeChain`, `screenToWorld`, `worldToScreen`, `hitTestLine`, `hitTestVertex`.
- **IDs**: `nextHexId(usedSet)` — random 16-bit, retry on collision.
- **File I/O** (`src/lib/shape-io.ts`): `serializeShape`, `deserializeShape` with Zod validation.
- **Keyboard**: `Esc` deselect/cancel ghost, `Delete` remove selected, `Tab` toggle mode, `Space` pan, `0` reset view, `F` fit, `Shift` snap-while-dragging.

## Out of scope

- Multiple shapes per file.
- Curves / arcs.

Confirm and I'll build it.
