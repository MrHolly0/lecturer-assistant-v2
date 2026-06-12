import { Eraser, Pencil, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Point = { x: number; y: number };
type DrawAction = { color: string; size: number; points: Point[]; erase?: boolean };
export type LiveAnnotations = Record<string, DrawAction[]>;

const COLORS = ["#dc2626", "#2563eb", "#16a34a", "#eab308", "#111827"];
const PEN_SIZES = [2, 5, 9];
const ERASER_SIZES = [12, 24, 36];

interface DrawingOverlayProps {
  slideIdx: number;
  annotations: LiveAnnotations;
  active: boolean;
  onChange: (annotations: LiveAnnotations) => void;
}

export function DrawingOverlay({ slideIdx, annotations, active, onChange }: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [erase, setErase] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(PEN_SIZES[1]);
  const [eraserSize, setEraserSize] = useState(ERASER_SIZES[1]);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const slideKey = String(slideIdx);
  const actions = useMemo(() => annotations[slideKey] ?? [], [annotations, slideKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      redraw(canvas, actions);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [actions]);

  function commit(next: DrawAction[]) {
    onChange({ ...annotations, [slideKey]: next });
  }

  function pos(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    };
  }

  return (
    <div ref={wrapRef} className="drawing-layer">
      <canvas
        ref={canvasRef}
        className={`drawing-canvas ${active ? "drawing-canvas--active" : ""}`}
        onPointerDown={(event) => {
          if (!active) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrawing(true);
          setPoints([pos(event)]);
        }}
        onPointerMove={(event) => {
          if (!active || !drawing) return;
          const next = [...points, pos(event)];
          setPoints(next);
          const canvas = canvasRef.current;
          if (canvas)
            redraw(canvas, [
              ...actions,
              { color, size: erase ? eraserSize : size, points: next, erase }
            ]);
        }}
        onPointerUp={() => {
          if (!active || !drawing || points.length < 2) return;
          commit([...actions, { color, size: erase ? eraserSize : size, points, erase }]);
          setDrawing(false);
          setPoints([]);
        }}
      />
      {active && (
        <div className="drawing-toolbar">
          <button
            type="button"
            className={`icon-button ${!erase ? "icon-button--active" : ""}`}
            onClick={() => setErase(false)}
            title="Карандаш"
          >
            <Pencil size={16} />
          </button>
          <div className="drawing-swatches" aria-label="Цвет пера">
            {COLORS.map((item) => (
              <button
                key={item}
                type="button"
                className={`color-swatch ${color === item && !erase ? "color-swatch--active" : ""}`}
                style={{ backgroundColor: item }}
                onClick={() => {
                  setColor(item);
                  setErase(false);
                }}
                title={`Цвет ${item}`}
              />
            ))}
          </div>
          <div className="drawing-sizes" aria-label="Толщина пера">
            {PEN_SIZES.map((item) => (
              <button
                key={item}
                type="button"
                className={`size-dot ${size === item && !erase ? "size-dot--active" : ""}`}
                onClick={() => {
                  setSize(item);
                  setErase(false);
                }}
                title={`Перо ${item}px`}
              >
                {item}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`icon-button ${erase ? "icon-button--active" : ""}`}
            onClick={() => setErase(true)}
            title="Ластик"
          >
            <Eraser size={16} />
          </button>
          <div className="drawing-sizes" aria-label="Толщина ластика">
            {ERASER_SIZES.map((item) => (
              <button
                key={item}
                type="button"
                className={`size-dot ${eraserSize === item && erase ? "size-dot--active" : ""}`}
                onClick={() => {
                  setEraserSize(item);
                  setErase(true);
                }}
                title={`Ластик ${item}px`}
              >
                {item}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => commit(actions.slice(0, -1))}
            title="Отменить"
          >
            <Undo2 size={16} />
          </button>
          <button type="button" className="icon-button" onClick={() => commit([])} title="Очистить">
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function redraw(canvas: HTMLCanvasElement, actions: DrawAction[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const action of actions) {
    ctx.strokeStyle = action.color;
    ctx.lineWidth = action.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = action.erase ? "destination-out" : "source-over";
    ctx.beginPath();
    action.points.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}
