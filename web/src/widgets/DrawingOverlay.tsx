import { Eraser, Pencil, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Point = { x: number; y: number };
type DrawAction = { color: string; size: number; points: Point[]; erase?: boolean };
export type LiveAnnotations = Record<string, DrawAction[]>;

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
            redraw(canvas, [...actions, { color: "#f97316", size: 4, points: next, erase }]);
        }}
        onPointerUp={() => {
          if (!active || !drawing || points.length < 2) return;
          commit([...actions, { color: "#f97316", size: 4, points, erase }]);
          setDrawing(false);
          setPoints([]);
        }}
      />
      {active && (
        <div className="drawing-toolbar">
          <button
            type="button"
            className="icon-button"
            onClick={() => setErase(false)}
            title="Карандаш"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setErase(true)}
            title="Ластик"
          >
            <Eraser size={16} />
          </button>
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
