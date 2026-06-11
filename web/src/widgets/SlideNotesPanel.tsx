import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, NotebookPen, X } from "lucide-react";
import type { SlideNote } from "../app/api/content-api";

interface SlideNotesPanelProps {
  slideIndex: number;
  note?: SlideNote;
  saving: boolean;
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
}

export function SlideNotesPanel({
  slideIndex,
  note,
  saving,
  onClose,
  onSave
}: SlideNotesPanelProps) {
  const [draft, setDraft] = useState(note?.content ?? "");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(note?.content ?? "");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [note?.content, slideIndex]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!dragOffset.current) return;
    setPos({ x: event.clientX - dragOffset.current.x, y: event.clientY - dragOffset.current.y });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragOffset.current = null;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const handleDragStart = (event: React.MouseEvent) => {
    const panel = panelRef.current;
    if (!panel || !panel.offsetParent) return;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = panel.offsetParent.getBoundingClientRect();
    const x = panelRect.left - parentRect.left;
    const y = panelRect.top - parentRect.top;
    dragOffset.current = { x: event.clientX - x, y: event.clientY - y };
    setPos({ x, y });
    event.preventDefault();
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const isDirty = draft !== (note?.content ?? "");

  return (
    <div
      ref={panelRef}
      id="slide-notes-panel"
      className="slide-notes-panel"
      role="dialog"
      aria-label="Заметки к слайду"
      style={pos ? { top: pos.y, left: pos.x, bottom: "auto" } : undefined}
    >
      <div className="snp-header snp-header--draggable" onMouseDown={handleDragStart}>
        <div className="snp-title">
          <NotebookPen size={15} />
          <span>Заметки - слайд {slideIndex}</span>
        </div>
        <button className="snp-close-btn" type="button" onClick={onClose} title="Закрыть">
          <X size={16} />
        </button>
      </div>
      <div className="snp-body">
        <textarea
          ref={textareaRef}
          id="slide-note-textarea"
          className="snp-textarea"
          placeholder="Ваши заметки к этому слайду..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void onSave(draft);
            }
            if (event.key === "Escape") onClose();
          }}
          rows={8}
        />
      </div>
      <div className="snp-footer">
        <button
          id="slide-notes-save-btn"
          className={`snp-btn snp-btn-primary ${!isDirty ? "snp-btn-disabled" : ""}`}
          type="button"
          disabled={!isDirty || saving}
          onClick={() => void onSave(draft)}
          title="Сохранить заметку"
        >
          {saving ? <Loader2 size={14} className="snp-spinner" /> : <Check size={14} />}
          Сохранить
        </button>
      </div>
      {note && (
        <div className="snp-hint">
          Обновлено:{" "}
          {new Date(note.updatedAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit"
          })}
        </div>
      )}
    </div>
  );
}
