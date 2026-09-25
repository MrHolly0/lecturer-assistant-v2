import { useState, type DragEvent } from "react";
import { GripVertical, MoreVertical } from "lucide-react";
import type { Slide } from "../app/api/content-api";
import { slideImageUrl } from "../app/api/content-api";
import { IconButton } from "../shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";

interface DeckSlideStripProps {
  slides: Slide[];
  activeIndex: number;
  canManage: boolean;
  editing: boolean;
  onSlideChange: (index: number) => void;
  onReorder: (fromIndex: number, targetIndex: number) => void;
}

export function DeckSlideStrip({
  slides,
  activeIndex,
  canManage,
  editing,
  onSlideChange,
  onReorder
}: DeckSlideStripProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);

  const finishDrag = () => {
    setDraggedIndex(null);
    setTargetIndex(null);
  };

  const startDrag = (event: DragEvent<HTMLElement>, index: number) => {
    if (!canManage || editing) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggedIndex(index);
  };

  const dropSlide = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    const fromIndex = draggedIndex;
    finishDrag();
    if (fromIndex !== null && fromIndex !== index) onReorder(fromIndex, index);
  };

  return (
    <>
      {canManage && (
        <p className="slide-strip__instruction">
          <GripVertical size={15} aria-hidden="true" />
          Порядок слайдов: перетащите за маркер или выберите позицию в меню.
        </p>
      )}
      <div className="slide-strip" aria-label="Слайды презентации">
        {slides.map((slide, index) => {
          const dragging = draggedIndex === index;
          const dropTarget = targetIndex === index && draggedIndex !== index;
          const dropSide =
            dropTarget && draggedIndex !== null
              ? draggedIndex < index
                ? " slide-thumb-shell--drop-after"
                : " slide-thumb-shell--drop-before"
              : "";
          return (
            <div
              key={slide.id}
              className={`slide-thumb-shell${index === activeIndex ? " slide-thumb-shell--active" : ""}${dragging ? " slide-thumb-shell--dragging" : ""}${dropSide}`}
              onDragOver={(event) => {
                if (draggedIndex === null || draggedIndex === index) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setTargetIndex(index);
              }}
              onDragLeave={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget)
                ) {
                  return;
                }
                if (targetIndex === index) setTargetIndex(null);
              }}
              onDrop={(event) => dropSlide(event, index)}
            >
              <button
                type="button"
                className="deck-slide-thumb__preview"
                onClick={() => onSlideChange(index)}
                aria-label={`Открыть слайд ${index + 1}`}
                aria-current={index === activeIndex ? "true" : undefined}
              >
                <img src={slideImageUrl(slide)} alt={`Слайд ${index + 1}`} />
              </button>
              <div className="deck-slide-thumb__footer">
                <span className="deck-slide-thumb__number">{index + 1}</span>
                {canManage && (
                  <>
                    <span
                      className="slide-thumb__drag-handle"
                      draggable={!editing}
                      title={`Перетащить слайд ${index + 1}`}
                      onDragStart={(event) => startDrag(event, index)}
                      onDragEnd={finishDrag}
                    >
                      <GripVertical size={16} aria-hidden="true" />
                    </span>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          className="slide-thumb__menu"
                          label={`Переместить слайд ${index + 1}`}
                          disabled={editing}
                        >
                          <MoreVertical size={17} aria-hidden="true" />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align={index === 0 ? "start" : "end"}
                        className="slide-position-menu"
                      >
                        <DropdownMenuLabel>Переместить в позицию</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={String(index)}
                          onValueChange={(value) => onReorder(index, Number(value))}
                        >
                          {slides.map((_, position) => (
                            <DropdownMenuRadioItem key={position} value={String(position)}>
                              Позиция {position + 1}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
