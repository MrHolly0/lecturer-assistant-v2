import { ChevronLeft, ChevronRight, NotebookPen } from "lucide-react";
import type { SlideDeckDetails } from "../app/api/content-api";
import { slideImageUrl } from "../app/api/content-api";
import { pluralizeRu } from "../shared/lib/plural";
import { SlideNotesPanel } from "./SlideNotesPanel";
import { IconButton } from "../shared/ui/button";

interface DeckViewerProps {
  deck: SlideDeckDetails;
  activeIndex: number;
  notesOpen: boolean;
  savingNote: boolean;
  onSlideChange: (index: number) => void;
  onNotesOpenChange: (open: boolean) => void;
  onSaveNote: (content: string) => Promise<void>;
  onClearNote: () => void;
}

export function DeckViewer({
  deck,
  activeIndex,
  notesOpen,
  savingNote,
  onSlideChange,
  onNotesOpenChange,
  onSaveNote,
  onClearNote
}: DeckViewerProps) {
  const slide = deck.slides[activeIndex];
  const slideNumber = slide?.idx ?? activeIndex + 1;

  if (!slide) {
    return <p className="muted">В презентации нет слайдов.</p>;
  }

  return (
    <section className="deck-viewer">
      <div className="deck-viewer__topbar">
        <div>
          <h2>{deck.title}</h2>
          <span className="muted">
            Версия {deck.version}, {deck.slides.length}{" "}
            {pluralizeRu(deck.slides.length, "слайд", "слайда", "слайдов")}
          </span>
        </div>
        <button
          type="button"
          className={`snp-trigger-btn ${notesOpen ? "snp-trigger-btn--on" : "snp-trigger-btn--off"}`}
          onClick={() => onNotesOpenChange(!notesOpen)}
        >
          <NotebookPen size={14} />
          Заметки
        </button>
      </div>

      <div className="deck-stage">
        <img
          src={slideImageUrl(slide)}
          alt={`Слайд ${slideNumber}`}
          className="deck-stage__image"
        />
        {notesOpen && (
          <SlideNotesPanel
            slideIndex={slideNumber}
            note={slide.note}
            saving={savingNote}
            onClose={() => onNotesOpenChange(false)}
            onSave={onSaveNote}
            onClear={onClearNote}
          />
        )}
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

      <div className="slide-strip">
        {deck.slides.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`slide-thumb ${index === activeIndex ? "slide-thumb--active" : ""}`}
            onClick={() => onSlideChange(index)}
            aria-label={`Перейти к слайду ${item.idx}`}
            aria-current={index === activeIndex ? "true" : undefined}
          >
            <img src={slideImageUrl(item)} alt={`Слайд ${item.idx}`} />
            <span>{item.idx}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
