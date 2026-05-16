import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { BlueprintCanvas, type Mode } from "@/components/BlueprintCanvas";
import { LINE_TYPES, type LineType, type Point } from "@/lib/shape-types";
import { useShapeStore } from "@/lib/use-shape-store";
import { deserializeShape, downloadJSON, serializeShape } from "@/lib/shape-io";
import { boundingBox, shoelaceArea, validateShape } from "@/lib/geometry";

export const Route = createFileRoute("/")({ component: ShapeEditorPage });

function ShapeEditorPage() {
  const store = useShapeStore();
  const [mode, setMode] = useState<Mode>("place");
  const [length, setLength] = useState(64);
  const [lineType, setLineType] = useState<LineType>("M");
  const [rotateDeg, setRotateDeg] = useState(15);
  const [cursorInfo, setCursorInfo] = useState<{
    world: Point;
    angleSnap: number | null;
    zoom: number;
  } | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [showBounds, setShowBounds] = useState(true);
  const [showIds, setShowIds] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => store.state.lines.find((l) => l.Id === store.state.selectedId) ?? null,
    [store.state],
  );

  const stats = useMemo(() => {
    const bb = boundingBox(store.state.lines);
    const w = bb.max.X - bb.min.X;
    const h = bb.max.Y - bb.min.Y;
    const cx = (bb.min.X + bb.max.X) / 2;
    const cy = (bb.min.Y + bb.max.Y) / 2;
    return {
      width: w,
      height: h,
      cx,
      cy,
      area: shoelaceArea(store.state.lines, store.state.closed),
    };
  }, [store.state]);

  const issues = useMemo(() => validateShape(store.state.lines, store.state.closed), [store.state]);

  const onSaveRef = useRef<() => void>(() => { });
  const onLoadClickRef = useRef<() => void>(() => { });

  const onSave = useCallback(() => {
    if (store.state.lines.length === 0) {
      toast.error("Nothing to save");
      return;
    }
    const data = serializeShape(store.state);
    downloadJSON(`shape-${Date.now()}.json`, data);
    toast.success("Shape exported");
  }, [store.state]);

  const onLoadClick = useCallback(() => fileInputRef.current?.click(), []);
  const onLoadFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        const next = deserializeShape(json);
        store.dispatch({ type: "load", state: next });
        toast.success(`Loaded ${next.lines.length} lines`);
        setFitTrigger((n) => n + 1);
      } catch (err) {
        console.error(err);
        toast.error("Invalid shape file");
      }
    },
    [store],
  );

  // keep refs fresh for keyboard handler
  useEffect(() => {
    onSaveRef.current = onSave;
    onLoadClickRef.current = onLoadClick;
  }, [onSave, onLoadClick]);

  // global keyboard shortcuts (canvas-level shortcuts live in BlueprintCanvas)
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
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      // save / load with modifier
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSaveRef.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onLoadClickRef.current();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "p":
          setMode("place");
          break;
        case "e":
          setMode("edit");
          break;
        case "tab":
          // handled below via e.key === 'Tab'
          break;
        case "c":
          store.dispatch({ type: "closeShape", lineType });
          break;
        case "f":
          setFitTrigger((n) => n + 1);
          break;
        case "0":
          setResetTrigger((n) => n + 1);
          break;
        case "b":
          setShowBounds((b) => !b);
          break;
        case "i":
          setShowIds((b) => !b);
          break;
        case "h":
          store.dispatch({ type: "mirror", axis: "h" });
          break;
        case "v":
          store.dispatch({ type: "mirror", axis: "v" });
          break;
        case "[":
          store.dispatch({ type: "rotate", deg: -15 });
          break;
        case "]":
          store.dispatch({ type: "rotate", deg: 15 });
          break;
        case "?":
          setShortcutsOpen((o) => !o);
          break;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        setMode((m) => (m === "place" ? "edit" : "place"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lineType, store]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0e3a6b] text-white">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/15 bg-[#0a2a52] px-3 py-2 text-xs">
        <Group label="Mode">
          <Toggle active={mode === "place"} onClick={() => setMode("place")}>
            Place
          </Toggle>
          <Toggle active={mode === "edit"} onClick={() => setMode("edit")}>
            Edit
          </Toggle>
        </Group>
        <Group label="Length">
          <NumInput value={length} onChange={setLength} min={1} step={1} width={70} />
          <span className="opacity-60">px</span>
        </Group>
        <Group label="Type">
          <Select
            value={lineType}
            onChange={(v) => setLineType(v as LineType)}
            options={LINE_TYPES}
          />
        </Group>
        <Btn
          onClick={() => store.dispatch({ type: "closeShape", lineType })}
          disabled={!!store.state.closed || !!(store.state.lines.length < 2)}
        >
          Close shape
        </Btn>
        {store.state.closed && (
          <Btn onClick={() => store.dispatch({ type: "openShape" })}>Re-open</Btn>
        )}
        <Sep />
        <Btn onClick={() => store.dispatch({ type: "undo" })} disabled={!store.canUndo}>
          Undo
        </Btn>
        <Btn onClick={() => store.dispatch({ type: "redo" })} disabled={!store.canRedo}>
          Redo
        </Btn>
        <Sep />
        <Group label="Rotate">
          <Btn onClick={() => store.dispatch({ type: "rotate", deg: -90 })}>−90°</Btn>
          <Btn onClick={() => store.dispatch({ type: "rotate", deg: 90 })}>+90°</Btn>
          <NumInput value={rotateDeg} onChange={setRotateDeg} step={1} width={56} />
          <Btn onClick={() => store.dispatch({ type: "rotate", deg: rotateDeg })}>Apply</Btn>
        </Group>
        <Group label="Mirror">
          <Btn onClick={() => store.dispatch({ type: "mirror", axis: "h" })}>H</Btn>
          <Btn onClick={() => store.dispatch({ type: "mirror", axis: "v" })}>V</Btn>
        </Group>
        <Sep />
        <Btn onClick={onSave}>Save JSON</Btn>
        <Btn onClick={onLoadClick}>Load JSON</Btn>
        <Btn
          onClick={() => {
            if (confirm("Discard current shape?")) {
              store.dispatch({ type: "reset" });
              setResetTrigger((n) => n + 1);
            }
          }}
        >
          New
        </Btn>
        <Sep />
        <Toggle active={showBounds} onClick={() => setShowBounds((b) => !b)}>
          Bounds
        </Toggle>
        <Toggle active={showIds} onClick={() => setShowIds((b) => !b)}>
          IDs
        </Toggle>
        <Btn onClick={() => setShortcutsOpen(true)}>Shortcuts</Btn>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onLoadFile}
        />
      </div>

      {/* Canvas + Sidebar */}
      <div className="relative flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <BlueprintCanvas
            store={store}
            mode={mode}
            length={length}
            lineType={lineType}
            showBounds={showBounds}
            showIds={showIds}
            onCursor={setCursorInfo}
            fitTrigger={fitTrigger}
            resetViewTrigger={resetTrigger}
          />

          {/* Floating zoom controls */}
          <div className="absolute bottom-3 right-3 flex gap-1 rounded-md bg-[#0a2a52]/90 px-2 py-1 text-xs backdrop-blur">
            <Btn onClick={() => setFitTrigger((n) => n + 1)}>Fit</Btn>
            <Btn onClick={() => setResetTrigger((n) => n + 1)}>Reset view</Btn>
          </div>

          {/* Hint */}
          <div className="pointer-events-none absolute left-3 top-3 max-w-[280px] rounded-md bg-[#0a2a52]/85 px-3 py-2 text-[11px] leading-relaxed text-white/85 backdrop-blur">
            {mode === "place" ? (
              <>
                <div className="font-semibold">Place mode</div>
                Move cursor → angle snaps to 15°. <b>Click</b> to place a line. Scroll = zoom ·
                Space/Middle-drag = pan.
              </>
            ) : (
              <>
                <div className="font-semibold">Edit mode</div>
                Click a line to select. Drag any vertex to reshape (Shift = snap 15°). Delete key
                removes selected line.
              </>
            )}
          </div>
        </div>

        {mode === "edit" && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-white/15 bg-[#0a2a52] p-3 text-xs">
            <div className="mb-2 font-semibold uppercase tracking-wide text-white/70">
              Selected line
            </div>
            {!selected ? (
              <div className="text-white/60">
                Click a line on the canvas to edit its properties.
              </div>
            ) : (
              <div className="space-y-3">
                <Field label="ID">
                  <code className="rounded bg-white/10 px-2 py-1">{selected.Id}</code>
                </Field>
                <Field label="Type">
                  <Select
                    value={selected.Type}
                    onChange={(v) =>
                      store.dispatch({
                        type: "updateLine",
                        id: selected.Id,
                        patch: { Type: v as LineType },
                      })
                    }
                    options={LINE_TYPES}
                  />
                </Field>
                <Field label="Length (px)">
                  <NumInput
                    value={Number(selected.Length.toFixed(3))}
                    onChange={(v) =>
                      store.dispatch({
                        type: "updateLine",
                        id: selected.Id,
                        patch: { Length: Math.max(0, v) },
                      })
                    }
                    step={1}
                    width={120}
                  />
                </Field>
                <Field label="Angle (°)">
                  <NumInput
                    value={Number(selected.Angle.toFixed(3))}
                    onChange={(v) =>
                      store.dispatch({
                        type: "updateLine",
                        id: selected.Id,
                        patch: { Angle: v },
                      })
                    }
                    step={1}
                    width={120}
                  />
                </Field>
                <Field label="Start">
                  <code className="text-white/70">
                    {selected.Start.X.toFixed(1)}, {selected.Start.Y.toFixed(1)}
                  </code>
                </Field>
                <Field label="End">
                  <code className="text-white/70">
                    {selected.End.X.toFixed(1)}, {selected.End.Y.toFixed(1)}
                  </code>
                </Field>
                <button
                  className="w-full rounded bg-red-500/80 px-3 py-1.5 font-medium hover:bg-red-500"
                  onClick={() => store.dispatch({ type: "deleteSelected" })}
                >
                  Delete line
                </button>
              </div>
            )}

            <div className="mt-6 border-t border-white/15 pt-3 text-white/70">
              <div className="font-semibold uppercase tracking-wide">Shape</div>
              <div>Lines: {store.state.lines.length}</div>
              <div>Closed: {store.state.closed ? "yes" : "no"}</div>
              <div>
                Size: {stats.width.toFixed(1)} × {stats.height.toFixed(1)}
              </div>
              <div>
                Center: {stats.cx.toFixed(1)}, {stats.cy.toFixed(1)}
              </div>
              <div>Area: {stats.area.toFixed(1)}</div>
            </div>

            <div className="mt-4 border-t border-white/15 pt-3">
              <div className="mb-1 font-semibold uppercase tracking-wide text-white/70">
                Validation
              </div>
              {issues.length === 0 ? (
                <div className="text-emerald-300">✓ Shape is valid</div>
              ) : (
                <ul className="space-y-1 text-amber-300">
                  {issues.map((m, i) => (
                    <li key={i}>• {m}</li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 border-t border-white/15 bg-[#0a2a52] px-3 py-1 font-mono text-[11px] text-white/80">
        <span>
          cursor:{" "}
          {cursorInfo ? `${cursorInfo.world.X.toFixed(1)}, ${cursorInfo.world.Y.toFixed(1)}` : "—"}
        </span>
        <span>zoom: {((cursorInfo?.zoom ?? 1) * 100).toFixed(0)}%</span>
        {cursorInfo?.angleSnap != null && <span>snap: {cursorInfo.angleSnap}°</span>}
        <span>lines: {store.state.lines.length}</span>
        <span>{store.state.closed ? "closed" : "open"}</span>
        <span>
          bbox: {stats.width.toFixed(1)}×{stats.height.toFixed(1)} · area {stats.area.toFixed(1)}
        </span>
        {issues.length === 0 ? (
          <span className="text-emerald-300">✓ valid</span>
        ) : (
          <span className="text-amber-300">
            ⚠ {issues.length} issue{issues.length > 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto opacity-60">Press ? for shortcuts</span>
      </div>

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      <Toaster />
    </div>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["P", "Place mode"],
    ["E", "Edit mode"],
    ["Tab", "Toggle mode"],
    ["C", "Close shape"],
    ["H / V", "Mirror horizontal / vertical"],
    ["[  /  ]", "Rotate −15° / +15°"],
    ["B", "Toggle bounding box"],
    ["F", "Fit shape to view"],
    ["0", "Reset view"],
    ["Wheel", "Zoom at cursor"],
    ["Space + drag", "Pan (also middle-mouse)"],
    ["Shift (while dragging vertex)", "Snap angle to 15°"],
    ["Ctrl/⌘ + Z", "Undo"],
    ["Ctrl/⌘ + Shift + Z", "Redo"],
    ["Ctrl/⌘ + S", "Save JSON"],
    ["Ctrl/⌘ + O", "Load JSON"],
    ["Delete", "Delete selected line"],
    ["Esc", "Deselect"],
    ["?", "Toggle this dialog"],
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-[460px] max-w-full overflow-y-auto rounded-lg border border-white/15 bg-[#0a2a52] p-5 text-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
          >
            Close
          </button>
        </div>
        <table className="w-full text-xs">
          <tbody>
            {rows.map(([k, d]) => (
              <tr key={k} className="border-t border-white/10">
                <td className="py-1.5 pr-4 font-mono text-amber-200">{k}</td>
                <td className="py-1.5 text-white/85">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- tiny UI primitives (kept local; styled to match blueprint) ----------

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1">
      <span className="text-[10px] uppercase tracking-wide text-white/60">{label}</span>
      {children}
    </div>
  );
}

function Sep() {
  return <div className="mx-1 h-5 w-px bg-white/15" />;
}

function Btn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || undefined}
      className="rounded bg-white/10 px-2 py-1 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 ${active ? "bg-amber-300 text-[#0a2a52]" : "bg-white/10 hover:bg-white/20"
        }`}
    >
      {children}
    </button>
  );
}

function NumInput({
  value,
  onChange,
  min,
  step = 1,
  width = 80,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  width?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      step={step}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      style={{ width }}
      className="rounded bg-white/10 px-1.5 py-0.5 text-white outline-none focus:bg-white/20"
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded bg-white/10 px-1.5 py-0.5 text-white outline-none focus:bg-white/20"
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-[#0a2a52]">
          {o}
        </option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/60">{label}</span>
      {children}
    </label>
  );
}
