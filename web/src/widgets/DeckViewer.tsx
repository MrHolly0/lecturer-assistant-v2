import { ChevronLeft, ChevronRight, NotebookPen, Trash2 } from "lucide-react";
import type { SlideDeckDetails } from "../app/api/content-api";
import { slideImageUrl } from "../app/api/content-api";
import { SlideNotesPanel } from "./SlideNotesPanel";
import { Button, IconButton } from "../shared/ui/button";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { DeckSlideStrip } from "./DeckSlideStrip";

interface DeckViewerProps {
  deck: SlideDeckDetails;
  activeIndex: number;
  notesOpen: boolean;
  savingNote: boolean;
  canManage: boolean;
  editing: boolean;
  onSlideChange: (index: number) => void;
  onNotesOpenChange: (open: boolean) => void;
  onSaveNote: (content: string) => Promise<void>;
  onClearNote: () => void;
  onReorderSlide: (fromIndex: number, targetIndex: number) => void;
  onDeleteSlide: () => void;
}

export function DeckViewer({
  deck,
  activeIndex,
  notesOpen,
  savingNote,
  canManage,
  editing,
  onSlideChange,
  onNotesOpenChange,
  onSaveNote,
  onClearNote,
  onReorderSlide,
  onDeleteSlide
}: DeckViewerProps) {
  const slide = deck.slides[activeIndex];
  const slideNumber = slide?.idx ?? activeIndex + 1;

  if (!slide) {
    return <p className="muted">В презентации нет слайдов.</p>;
  }

  return (
    <section className="deck-viewer preparation-deck-viewer" aria-label={deck.title}>
      <div className="preparation-viewer-grid">
        <div className="preparation-slide-column">
          <div className="deck-stage">
            <img
              src={slideImageUrl(slide)}
              alt={`Слайд ${slideNumber}`}
              className="deck-stage__image"
            />
          </div>
          <div className="deck-controls">
            <IconButton
              variant="outline"
              type="button"
              disabled={activeIndex === 0}
              onClick={() => onSlideChange(activeIndex - 1)}
              label="Предыдущий слайд"
            >
              <ChevronLeft size={16} />
            </IconButton>
            <span>
              {slideNumber} / {deck.slides.length}
            </span>
            <IconButton
              variant="outline"
              type="button"
              disabled={activeIndex >= deck.slides.length - 1}
              onClick={() => onSlideChange(activeIndex + 1)}
              label="Следующий слайд"
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>

          <DeckSlideStrip
            slides={deck.slides}
            activeIndex={activeIndex}
            canManage={canManage}
            editing={editing}
            onSlideChange={onSlideChange}
            onReorder={onReorderSlide}
          />
          {canManage && (
            <div className="preparation-slide-actions">
              <ConfirmActionButton
                title={`Удалить слайд ${slideNumber}?`}
                description="Слайд и его заметка будут удалены. Если у презентации есть история занятий или она в архиве, создастся копия, связанные лекции перейдут на неё. Иначе изменится текущая версия. Во время занятия изменение недоступно. Слайды прошедших занятий сохраняются."
                confirmLabel="Удалить слайд"
                variant="outline"
                disabled={editing || deck.slides.length <= 1}
                onConfirm={onDeleteSlide}
              >
                <Trash2 size={18} aria-hidden="true" /> Удалить слайд
              </ConfirmActionButton>
            </div>
          )}
        </div>
        <aside className="preparation-notes-column">
          {notesOpen ? (
            <SlideNotesPanel
              slideIndex={slideNumber}
              note={slide.note}
              saving={savingNote}
              readOnly={!canManage}
              onClose={() => onNotesOpenChange(false)}
              onSave={onSaveNote}
              onClear={onClearNote}
            />
          ) : (
            <Button type="button" variant="outline" onClick={() => onNotesOpenChange(true)}>
              <NotebookPen size={18} aria-hidden="true" /> Заметки к слайду {slideNumber}
            </Button>
          )}
        </aside>
      </div>
    </section>
  );
}
