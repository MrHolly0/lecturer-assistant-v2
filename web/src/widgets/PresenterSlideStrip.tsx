import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { slideImageUrl, type Slide } from "../app/api/content-api";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";

export function PresenterSlideStrip({
  slides,
  currentSlideIdx,
  disabled,
  onShow
}: {
  slides: Slide[];
  currentSlideIdx: number;
  disabled: boolean;
  onShow: (idx: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const previewOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  const preview = slides.find((slide) => slide.idx === previewIdx);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const update = () =>
      setCanScroll({
        left: strip.scrollLeft > 1,
        right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
      });
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    strip.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", update);
    };
  }, [slides.length]);

  useEffect(() => {
    setPreviewIdx(null);
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>(`[data-slide-index="${currentSlideIdx}"]`);
    if (!strip || !active) return;
    const rail = strip.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.left < rail.left || item.right > rail.right) {
      strip.scrollTo({
        left: strip.scrollLeft + item.left - rail.left - (strip.clientWidth - item.width) / 2
      });
    }
  }, [currentSlideIdx]);

  function scroll(direction: number) {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({
      left: direction * strip.clientWidth * 0.8,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
    });
  }

  return (
    <>
      <div className="presenter-strip-controls">
        <Button
          type="button"
          variant="outline"
          aria-label="Прокрутить слайды влево"
          disabled={!canScroll.left}
          onClick={() => scroll(-1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </Button>
        <div className="presenter-slide-strip" ref={stripRef} aria-label="Слайды занятия">
          {slides.map((slide) => (
            <div className="presenter-slide-item" key={slide.id} data-slide-index={slide.idx}>
              <button
                type="button"
                disabled={disabled}
                className={`slide-thumb${slide.idx === currentSlideIdx ? " slide-thumb--active" : ""}`}
                onClick={() => onShow(slide.idx)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  previewOpenerRef.current = event.currentTarget;
                  setPreviewIdx(slide.idx);
                }}
                aria-label={`Показать слайд ${slide.idx} аудитории`}
                aria-current={slide.idx === currentSlideIdx ? "true" : undefined}
                title={`Показать слайд ${slide.idx} аудитории`}
              >
                <img src={slideImageUrl(slide)} alt="" />
                <span className="slide-thumb__number">{slide.idx}</span>
              </button>
              <button
                type="button"
                className="presenter-slide-preview"
                aria-label={`Предпросмотр слайда ${slide.idx}`}
                title="Предпросмотр, аудитория не увидит"
                onClick={(event) => {
                  previewOpenerRef.current = event.currentTarget;
                  setPreviewIdx(slide.idx);
                }}
              >
                <Eye size={18} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          aria-label="Прокрутить слайды вправо"
          disabled={!canScroll.right}
          onClick={() => scroll(1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </Button>
      </div>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreviewIdx(null)}>
        <DialogContent
          className="presenter-slide-preview-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = previewOpenerRef.current;
            if (opener?.isConnected) opener.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>Предпросмотр слайда {preview?.idx}</DialogTitle>
            <DialogDescription>Аудитория сейчас видит слайд {currentSlideIdx}.</DialogDescription>
          </DialogHeader>
          {preview && <img src={slideImageUrl(preview)} alt={`Слайд ${preview.idx}`} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewIdx(null)}>
              Закрыть
            </Button>
            <Button
              type="button"
              disabled={disabled || preview?.idx === currentSlideIdx}
              onClick={() => preview && onShow(preview.idx)}
            >
              Показать аудитории
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
