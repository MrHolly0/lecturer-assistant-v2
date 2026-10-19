import { Eraser, Grip, Pencil, Redo2, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useViewportDrag } from "./useViewportDrag";

type Point = { x: number; y: number };
type DrawAction = {
  color: string;
  size: number;
  relativeSize?: number;
  points: Point[];
  erase?: boolean;
};
export type LiveAnnotations = Record<string, DrawAction[]>;
type DrawingHistory = { past: DrawAction[][]; future: DrawAction[][]; signature: string };

const COLORS = ["#dc2626", "#2563eb", "#16a34a", "#eab308", "#111827"];
const COLOR_LABELS: Record<string, string> = {
  "#dc2626": "красный",
  "#2563eb": "синий",
  "#16a34a": "зелёный",
  "#eab308": "жёлтый",
  "#111827": "чёрный"
};
const PEN_SIZES = [2, 5, 9];
const ERASER_SIZES = [12, 24, 36];

interface DrawingOverlayProps {
  imageRef: RefObject<HTMLImageElement>;
  slideIdx: number;
  annotations: LiveAnnotations;
  active: boolean;
  onChange: (annotations: LiveAnnotations) => void;
  onClose?: () => void;
  toolsVisible?: boolean;
  saveError?: boolean;
  saving?: boolean;
  onRetry?: () => void;
}

export function DrawingOverlay({
  imageRef,
  slideIdx,
  annotations,
  active,
  toolsVisible = active,
  onChange,
  onClose,
  saveError = false,
  saving = false,
  onRetry
}: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [erase, setErase] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(PEN_SIZES[1]);
  const [eraserSize, setEraserSize] = useState(ERASER_SIZES[1]);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [histories, setHistories] = useState<Record<string, DrawingHistory>>({});
  const toolbarDrag = useViewportDrag<HTMLDivElement>({
    x: Math.max(16, window.innerWidth - 496),
    y: Math.max(16, window.innerHeight - 190)
  });
  const slideKey = String(slideIdx);
  const actions = useMemo(() => annotations[slideKey] ?? [], [annotations, slideKey]);
  const signature = useMemo(() => JSON.stringify(actions), [actions]);
  const history = histories[slideKey]?.signature === signature ? histories[slideKey] : undefined;
  const canUndo = actions.length > 0 || Boolean(history?.past.length);
  const canRedo = Boolean(history?.future.length);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const image = imageRef.current;
    if (!canvas || !wrap || !image) return;
    const resize = () => {
      const imageRect = image.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const scale = Math.min(
        imageRect.width / image.naturalWidth,
        imageRect.height / image.naturalHeight
      );
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const visible = image.complete && Number.isFinite(scale) && width > 0 && height > 0;
      canvas.hidden = !visible;
      if (!visible) return;
      // Match the image's object-fit: contain rectangle, excluding its letterbox bars.
      canvas.style.left = `${imageRect.left - wrapRect.left + (imageRect.width - width) / 2}px`;
      canvas.style.top = `${imageRect.top - wrapRect.top + (imageRect.height - height) / 2}px`;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      redraw(canvas, actions);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    observer.observe(image);
    image.addEventListener("load", resize);
    image.addEventListener("error", resize);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      image.removeEventListener("load", resize);
      image.removeEventListener("error", resize);
      window.removeEventListener("resize", resize);
    };
  }, [actions, imageRef, slideIdx]);

  function stroke(points: Point[]): DrawAction {
    const strokeSize = erase ? eraserSize : size;
    return {
      color,
      size: strokeSize,
      relativeSize: strokeSize / (canvasRef.current?.getBoundingClientRect().width || 1),
      points,
      erase
    };
  }

  function commit(next: DrawAction[]) {
    setHistories((current) => ({
      ...current,
      [slideKey]: {
        past: [...(history?.past ?? []), actions],
        future: [],
        signature: JSON.stringify(next)
      }
    }));
    onChange({ ...annotations, [slideKey]: next });
  }

  function undo() {
    if (!canUndo) return;
    const past = history?.past ?? [];
    const next = past.length ? past[past.length - 1] : actions.slice(0, -1);
    setHistories((current) => ({
      ...current,
      [slideKey]: {
        past: past.slice(0, -1),
        future: [...(history?.future ?? []), actions],
        signature: JSON.stringify(next)
      }
    }));
    onChange({ ...annotations, [slideKey]: next });
  }

  function redo() {
    if (!history?.future.length) return;
    const next = history.future[history.future.length - 1];
    setHistories((current) => ({
      ...current,
      [slideKey]: {
        past: [...history.past, actions],
        future: history.future.slice(0, -1),
        signature: JSON.stringify(next)
      }
    }));
    onChange({ ...annotations, [slideKey]: next });
  }

  function pos(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    };
  }

  const saveFailure = saveError && onRetry && (
    <div className="drawing-save-error" role="alert">
      <span>Рисунок не сохранён</span>
      <button type="button" onClick={onRetry} disabled={saving || !active}>
        {saving ? "Сохраняем…" : "Повторить"}
      </button>
    </div>
  );

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
          if (canvas) redraw(canvas, [...actions, stroke(next)]);
        }}
        onPointerUp={() => {
          if (!active || !drawing) return;
          if (points.length >= 2) {
            commit([...actions, stroke(points)]);
          }
          setDrawing(false);
          setPoints([]);
        }}
        onPointerCancel={() => {
          setDrawing(false);
          setPoints([]);
          const canvas = canvasRef.current;
          if (canvas) redraw(canvas, actions);
        }}
      />
      {toolsVisible && (
        <div
          ref={toolbarDrag.panelRef}
          className="drawing-toolbar drawing-toolbar--desktop presenter-tools__drawing-toolbar presenter-tools__drawing-toolbar--desktop"
          style={{
            ...toolbarDrag.viewportStyle,
            left: toolbarDrag.position.x,
            top: toolbarDrag.position.y
          }}
          role="toolbar"
          aria-label="Инструменты рисования"
        >
          <div className="presenter-tools__drawing-header">
            <div {...toolbarDrag.handleProps} className="presenter-tools__drag-handle">
              <Grip size={16} aria-hidden="true" />
              <span>Рисование · переместить</span>
            </div>
            {onClose && (
              <button
                type="button"
                className="presenter-tools__icon"
                onClick={onClose}
                aria-label="Закрыть рисование"
                title="Закрыть рисование"
              >
                <X size={17} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="drawing-tool-row drawing-tool-row--pen">
            <button
              type="button"
              className={`icon-button ${!erase ? "icon-button--active" : ""}`}
              onClick={() => setErase(false)}
              title="Карандаш"
              aria-label="Карандаш"
              aria-pressed={!erase}
            >
              <Pencil size={16} />
            </button>
            <div className="drawing-swatches" role="group" aria-label="Цвет пера">
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
                  title={`Цвет пера: ${COLOR_LABELS[item]}`}
                  aria-label={`Цвет пера: ${COLOR_LABELS[item]}`}
                  aria-pressed={color === item && !erase}
                />
              ))}
            </div>
            <div className="drawing-sizes" role="group" aria-label="Толщина пера">
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
                  aria-label={`Толщина пера ${item} пикселей`}
                  aria-pressed={size === item && !erase}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="drawing-tool-row drawing-tool-row--eraser">
            <button
              type="button"
              className={`icon-button ${erase ? "icon-button--active" : ""}`}
              onClick={() => setErase(true)}
              title="Ластик"
              aria-label="Ластик"
              aria-pressed={erase}
            >
              <Eraser size={16} />
            </button>
            <div className="drawing-sizes" role="group" aria-label="Толщина ластика">
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
                  aria-label={`Толщина ластика ${item} пикселей`}
                  aria-pressed={eraserSize === item && erase}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="drawing-history-actions" role="group" aria-label="История рисования">
              <button
                type="button"
                className="icon-button"
                onClick={undo}
                title="Отменить"
                aria-label="Отменить последнее действие"
                disabled={!active || !canUndo}
              >
                <Undo2 size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={redo}
                title="Повторить"
                aria-label="Повторить отменённое действие"
                disabled={!active || !canRedo}
              >
                <Redo2 size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => commit([])}
                title="Очистить"
                aria-label="Очистить рисунок"
                disabled={!active || actions.length === 0}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          {saveFailure}
        </div>
      )}
      {toolsVisible && (
        <div className="drawing-mobile-workspace">
          <div className="drawing-mobile-settings">
            {!erase && (
              <>
                <span>Цвет пера</span>
                <div className="drawing-swatches" role="group" aria-label="Цвет пера">
                  {COLORS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`color-swatch${color === item ? " color-swatch--active" : ""}`}
                      style={{ backgroundColor: item }}
                      onClick={() => setColor(item)}
                      aria-label={`Цвет пера: ${COLOR_LABELS[item]}`}
                      aria-pressed={color === item}
                    />
                  ))}
                </div>
              </>
            )}
            <span>{erase ? "Толщина ластика" : "Толщина пера"}</span>
            <div
              className="drawing-sizes"
              role="group"
              aria-label={erase ? "Толщина ластика" : "Толщина пера"}
            >
              {(erase ? ERASER_SIZES : PEN_SIZES).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`size-dot${(erase ? eraserSize : size) === item ? " size-dot--active" : ""}`}
                  onClick={() => (erase ? setEraserSize(item) : setSize(item))}
                  aria-label={`Толщина ${erase ? "ластика" : "пера"} ${item} пикселей`}
                  aria-pressed={(erase ? eraserSize : size) === item}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div
            className="drawing-toolbar drawing-toolbar--mobile presenter-tools__drawing-toolbar presenter-tools__drawing-toolbar--mobile"
            role="toolbar"
            aria-label="Инструменты рисования"
          >
            <button
              type="button"
              className={`drawing-mobile-tool${!erase ? " drawing-mobile-tool--active" : ""}`}
              onClick={() => setErase(false)}
              aria-pressed={!erase}
            >
              <Pencil size={17} aria-hidden="true" />
              Перо
            </button>
            <button
              type="button"
              className={`drawing-mobile-tool${erase ? " drawing-mobile-tool--active" : ""}`}
              onClick={() => setErase(true)}
              aria-pressed={erase}
            >
              <Eraser size={17} aria-hidden="true" />
              Ластик
            </button>
            <button
              type="button"
              className="drawing-mobile-tool drawing-mobile-tool--icon"
              onClick={undo}
              aria-label="Отменить последнее действие"
              disabled={!active || !canUndo}
            >
              <Undo2 size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="drawing-mobile-tool drawing-mobile-tool--icon"
              onClick={redo}
              aria-label="Повторить отменённое действие"
              disabled={!active || !canRedo}
            >
              <Redo2 size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="drawing-mobile-tool drawing-mobile-tool--icon"
              onClick={() => commit([])}
              aria-label="Очистить рисунок"
              disabled={!active || actions.length === 0}
            >
              <Trash2 size={17} aria-hidden="true" />
            </button>
            {onClose && (
              <button
                type="button"
                className="drawing-mobile-tool drawing-mobile-tool--icon drawing-mobile-tool--close"
                onClick={onClose}
                aria-label="Закрыть рисование"
                title="Закрыть рисование"
              >
                <X size={17} aria-hidden="true" />
              </button>
            )}
          </div>
          {saveFailure}
        </div>
      )}
    </div>
  );
}

function redraw(canvas: HTMLCanvasElement, actions: DrawAction[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  for (const action of actions) {
    ctx.strokeStyle = action.color;
    ctx.lineWidth = action.relativeSize ? action.relativeSize * width : action.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = action.erase ? "destination-out" : "source-over";
    ctx.beginPath();
    action.points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}
