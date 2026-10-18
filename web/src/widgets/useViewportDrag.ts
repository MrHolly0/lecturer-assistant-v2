import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties
} from "react";

type Position = { x: number; y: number };

/** Drag a fixed panel from its handle while keeping it reachable in the viewport. */
export function useViewportDrag<T extends HTMLElement>(initial: Position) {
  const nodeRef = useRef<T | null>(null);
  const [panel, setPanel] = useState<T | null>(null);
  const panelRef = useCallback((node: T | null) => {
    nodeRef.current = node;
    setPanel(node);
  }, []);
  const [position, setPosition] = useState(initial);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const dragOrigin = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const clamp = useCallback((left: number, top: number): Position => {
    const node = nodeRef.current;
    const rect = node?.getBoundingClientRect();
    const owner = node?.ownerDocument.defaultView ?? window;
    const viewport = owner.visualViewport;
    const width = viewport?.width ?? owner.innerWidth;
    const height = viewport?.height ?? owner.innerHeight;
    const minLeft = (viewport?.offsetLeft ?? 0) + 8;
    const minTop = (viewport?.offsetTop ?? 0) + 8;
    const maxLeft = Math.max(minLeft, minLeft + width - (rect?.width ?? 96) - 16);
    const maxTop = Math.max(minTop, minTop + height - (rect?.height ?? 64) - 16);
    return {
      x: Math.min(maxLeft, Math.max(minLeft, left)),
      y: Math.min(maxTop, Math.max(minTop, top))
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const current = nodeRef.current?.getBoundingClientRect();
    if (!current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = {
      x: event.clientX,
      y: event.clientY,
      left: current.left,
      top: current.top
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    setPosition(
      clamp(origin.left + event.clientX - origin.x, origin.top + event.clientY - origin.y)
    );
  };
  const stopDragging = () => {
    dragOrigin.current = null;
  };
  const onKeyDown: HTMLAttributes<HTMLElement>["onKeyDown"] = (event) => {
    const step = event.shiftKey ? 48 : 16;
    const offsets: Record<string, Position> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step }
    };
    if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      setPosition(clamp(initial.x, initial.y));
      return;
    }
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    event.stopPropagation();
    setPosition((current) => clamp(current.x + offset.x, current.y + offset.y));
  };

  useEffect(() => {
    if (!panel) return;
    const owner = panel.ownerDocument.defaultView ?? window;
    const adjust = () => {
      setViewportHeight(owner.visualViewport?.height ?? owner.innerHeight);
      setPosition((current) => {
        const next = clamp(current.x, current.y);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    };
    owner.addEventListener("resize", adjust);
    owner.visualViewport?.addEventListener("resize", adjust);
    owner.visualViewport?.addEventListener("scroll", adjust);
    const observer = new ResizeObserver(adjust);
    observer.observe(panel);
    adjust();
    return () => {
      owner.removeEventListener("resize", adjust);
      owner.visualViewport?.removeEventListener("resize", adjust);
      owner.visualViewport?.removeEventListener("scroll", adjust);
      observer.disconnect();
    };
  }, [clamp, panel]);

  return {
    panelRef,
    position,
    viewportStyle: { "--presenter-tool-height": `${viewportHeight}px` } as CSSProperties,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: stopDragging,
      onPointerCancel: stopDragging,
      onLostPointerCapture: stopDragging,
      onKeyDown,
      role: "button" as const,
      tabIndex: 0,
      "aria-label": "Переместить панель. Используйте стрелки, Home возвращает исходное положение.",
      title:
        "Переместить панель · стрелки — с шагом 16 px, Shift — 48 px, Home — исходное положение"
    }
  };
}
