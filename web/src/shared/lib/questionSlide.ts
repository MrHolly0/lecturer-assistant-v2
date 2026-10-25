export function questionSlideLabel(slideIdx: number | null | undefined): string {
  return Number.isInteger(slideIdx) && slideIdx! > 0
    ? `Слайд ${slideIdx}`
    : "Слайд не зафиксирован";
}
