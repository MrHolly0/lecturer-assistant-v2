import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Grip, PanelRightOpen, X } from "lucide-react";
import type { Slide } from "../app/api/content-api";
import { LiveSlideNotesEditor } from "./LiveSlideNotesEditor";
import { useViewportDrag } from "./useViewportDrag";

type NotesWorkspaceValue = {
  slide: Slide;
  courseId: string;
  drafts: Record<number, string>;
  updateDraft: (slideIdx: number, content?: string, expectedContent?: string) => void;
  detached: boolean;
  openFloating: (trigger?: HTMLElement | null) => void;
  openWindow: (trigger?: HTMLElement | null) => void;
  dock: () => void;
  blocked: boolean;
};

const NotesWorkspaceContext = createContext<NotesWorkspaceValue | null>(null);

export function PresenterNotesWorkspace({
  courseId,
  slide,
  children
}: {
  courseId: string;
  slide: Slide;
  children: ReactNode;
}) {
  const [popupName] = useState(() => `lecturer-slide-notes-${crypto.randomUUID()}`);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [detached, setDetached] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [popupWindow, setPopupWindow] = useState<Window | null>(null);
  const [popupMount, setPopupMount] = useState<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const restoreFocus = useCallback(() => {
    window.setTimeout(() => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    }, 0);
  }, []);

  const updateDraft = useCallback(
    (slideIdx: number, content?: string, expectedContent?: string) => {
      setDrafts((current) => {
        if (content === undefined) {
          if (expectedContent !== undefined && current[slideIdx] !== expectedContent)
            return current;
          if (!(slideIdx in current)) return current;
          const next = { ...current };
          delete next[slideIdx];
          return next;
        }
        return { ...current, [slideIdx]: content };
      });
    },
    []
  );
  const openFloating = useCallback((trigger?: HTMLElement | null) => {
    returnFocusRef.current = trigger ?? null;
    setPopupBlocked(false);
    setDetached(true);
  }, []);
  const openWindow = useCallback(
    (trigger?: HTMLElement | null) => {
      returnFocusRef.current = trigger ?? null;
      // Keep window.open in the click call stack so browser popup blockers allow it.
      const opened = window.open(
        "",
        popupName,
        "popup,width=520,height=700,resizable=yes,scrollbars=yes"
      );
      if (!opened) {
        setPopupBlocked(true);
        return;
      }
      prepareNotesWindow(opened);
      setPopupBlocked(false);
      setDetached(true);
      setPopupWindow(opened);
    },
    [popupName]
  );
  const dock = useCallback(() => {
    popupWindow?.close();
    setPopupWindow(null);
    setDetached(false);
    setPopupBlocked(false);
    restoreFocus();
  }, [popupWindow, restoreFocus]);

  useEffect(() => {
    if (!popupWindow) {
      setPopupMount(null);
      return;
    }
    const mount = popupWindow.document.createElement("div");
    mount.className = "presenter-tools-popup-root";
    popupWindow.document.body.appendChild(mount);
    setPopupMount(mount);
    return () => mount.remove();
  }, [popupWindow]);

  useEffect(() => {
    if (!popupWindow) return;
    const timer = window.setInterval(() => {
      if (!popupWindow.closed) return;
      setPopupWindow(null);
      setDetached(false);
      restoreFocus();
    }, 500);
    return () => window.clearInterval(timer);
  }, [popupWindow, restoreFocus]);
  useEffect(() => {
    if (!popupWindow) return;
    const syncTheme = () => {
      if (popupWindow.closed) return;
      const sourceRoot = document.documentElement;
      const targetRoot = popupWindow.document.documentElement;
      targetRoot.className = sourceRoot.className;
      for (const name of ["data-theme", "style"]) {
        const value = sourceRoot.getAttribute(name);
        if (value === null) targetRoot.removeAttribute(name);
        else targetRoot.setAttribute(name, value);
      }
      popupWindow.document.body.className = document.body.className;
    };
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"]
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    syncTheme();
    return () => observer.disconnect();
  }, [popupWindow]);
  useEffect(() => {
    const close = () => popupWindow?.close();
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, [popupWindow]);
  useEffect(() => () => popupMount?.remove(), [popupMount]);

  const value = useMemo<NotesWorkspaceValue>(
    () => ({
      slide,
      courseId,
      drafts,
      updateDraft,
      detached,
      openFloating,
      openWindow,
      dock,
      blocked: popupBlocked
    }),
    [slide, courseId, drafts, updateDraft, detached, openFloating, openWindow, dock, popupBlocked]
  );

  const detachedPanel = detached && (
    <DetachedNotesPanel
      courseId={courseId}
      slide={slide}
      drafts={drafts}
      updateDraft={updateDraft}
      onDock={dock}
      inWindow={Boolean(popupWindow)}
      popupWindow={popupWindow}
      popupMount={popupMount}
    />
  );

  return (
    <NotesWorkspaceContext.Provider value={value}>
      {children}
      {detachedPanel}
    </NotesWorkspaceContext.Provider>
  );
}

export function PresenterNotesActions() {
  const workspace = useNotesWorkspace();
  return (
    <div className="presenter-tools__actions">
      <button
        type="button"
        className="presenter-tools__action"
        onClick={(event) => workspace.openFloating(event.currentTarget)}
        disabled={workspace.detached}
      >
        <PanelRightOpen size={16} aria-hidden="true" /> Открыть в панели
      </button>
      <button
        type="button"
        className="presenter-tools__action"
        onClick={(event) => workspace.openWindow(event.currentTarget)}
        disabled={workspace.detached}
      >
        <ExternalLink size={16} aria-hidden="true" /> На отдельный экран
      </button>
      {workspace.blocked && (
        <div className="presenter-tools__fallback" role="status">
          Браузер заблокировал отдельное окно. Можно открыть заметки в панели здесь.
          <button
            type="button"
            className="presenter-tools__action"
            onClick={(event) => workspace.openFloating(event.currentTarget)}
          >
            Открыть здесь
          </button>
        </div>
      )}
      {workspace.detached && (
        <p className="presenter-tools__hint">Заметки открыты отдельно. Они видны только вам.</p>
      )}
    </div>
  );
}

export function PresenterNotesDockedEditor() {
  const workspace = useNotesWorkspace();
  if (workspace.detached) return null;
  return <NotesEditor courseId={workspace.courseId} slide={workspace.slide} />;
}

function DetachedNotesPanel({
  courseId,
  slide,
  drafts,
  updateDraft,
  onDock,
  inWindow,
  popupWindow,
  popupMount
}: {
  courseId: string;
  slide: Slide;
  drafts: Record<number, string>;
  updateDraft: (slideIdx: number, content?: string, expectedContent?: string) => void;
  onDock: () => void;
  inWindow: boolean;
  popupWindow: Window | null;
  popupMount: HTMLDivElement | null;
}) {
  const drag = useViewportDrag<HTMLDivElement>({ x: Math.max(8, window.innerWidth - 424), y: 72 });
  const style = { ...drag.viewportStyle, left: drag.position.x, top: drag.position.y };
  const panel = (
    <section
      ref={drag.panelRef}
      className={
        "presenter-tools__floating" + (inWindow ? " presenter-tools__floating--popup" : "")
      }
      style={inWindow ? undefined : style}
      aria-label="Заметки докладчика"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onDock();
      }}
    >
      <header className="presenter-tools__header">
        <div {...drag.handleProps} className="presenter-tools__drag-handle">
          <Grip size={16} aria-hidden="true" />
          <span>Заметки · слайд {slide.idx}</span>
        </div>
        <div className="presenter-tools__header-actions">
          <button
            type="button"
            className="presenter-tools__icon"
            onClick={onDock}
            aria-label="Вернуть заметки в боковую панель"
            title="Вернуть в боковую панель"
          >
            <PanelRightOpen size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="presenter-tools__icon"
            onClick={onDock}
            aria-label="Закрыть отдельные заметки"
            title="Закрыть"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="presenter-tools__body">
        <p className="question-privacy-hint">
          Видны только вам. На проекторе и у студентов их нет.
        </p>
        <NotesEditor courseId={courseId} slide={slide} drafts={drafts} updateDraft={updateDraft} />
      </div>
    </section>
  );

  if (inWindow && popupWindow) return popupMount ? createPortal(panel, popupMount) : null;
  if (typeof document !== "undefined") return createPortal(panel, document.body);
  return null;
}

function NotesEditor({
  courseId,
  slide,
  drafts,
  updateDraft
}: {
  courseId: string;
  slide: Slide;
  drafts?: Record<number, string>;
  updateDraft?: (slideIdx: number, content?: string, expectedContent?: string) => void;
}) {
  const workspace = useContext(NotesWorkspaceContext);
  const draftMap = drafts ?? workspace?.drafts;
  const onChange = updateDraft ?? workspace?.updateDraft;
  return (
    <LiveSlideNotesEditor
      courseId={courseId}
      deckId={slide.deckId}
      slide={slide}
      draft={draftMap?.[slide.idx] ?? slide.note?.content ?? ""}
      onDraftChange={(slideIdx, content, expectedContent) =>
        onChange?.(slideIdx, content, expectedContent)
      }
    />
  );
}

function useNotesWorkspace() {
  const workspace = useContext(NotesWorkspaceContext);
  if (!workspace)
    throw new Error("Presenter notes controls must be inside PresenterNotesWorkspace.");
  return workspace;
}

function prepareNotesWindow(popup: Window) {
  const source = document;
  const target = popup.document;
  target.open();
  target.write("<!doctype html><html><head></head><body></body></html>");
  target.close();
  for (const attribute of Array.from(source.documentElement.attributes)) {
    target.documentElement.setAttribute(attribute.name, attribute.value);
  }
  target.body.className = source.body.className;
  target.title = "Заметки докладчика";
  const viewport = source.querySelector('meta[name="viewport"]');
  if (viewport) target.head.append(viewport.cloneNode(true));
  source.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    target.head.append(node.cloneNode(true));
  });
  target.body.style.margin = "0";
  target.body.style.minWidth = "0";
  target.body.style.minHeight = "100vh";
}
