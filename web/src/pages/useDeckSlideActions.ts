import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  deleteDeckSlide,
  reorderDeckSlides,
  type DeckEditResult,
  type SlideDeckDetails
} from "../app/api/content-api";
import { userErrorMessage } from "../app/api/errors";

interface DeckSlideActionsOptions {
  courseId: string;
  deck: SlideDeckDetails | undefined;
  activeIndex: number;
  onDeckSelected: (deckId: string) => void;
  onActiveIndexChange: (index: number) => void;
}

export function useDeckSlideActions({
  courseId,
  deck,
  activeIndex,
  onDeckSelected,
  onActiveIndexChange
}: DeckSlideActionsOptions) {
  const qc = useQueryClient();

  const applyDeckEdit = (result: DeckEditResult, targetIndex?: number) => {
    qc.setQueryData(["content", courseId, "decks", result.deck.id], result.deck);
    onDeckSelected(result.deck.id);
    onActiveIndexChange(Math.min(targetIndex ?? activeIndex, result.deck.slides.length - 1));
    void qc.invalidateQueries({ queryKey: ["content", courseId, "decks"] });
    void qc.invalidateQueries({ queryKey: ["content", courseId, "lectures"] });
    toast.success(
      result.copyOnWrite
        ? `Создана версия ${result.deck.version}. Будущие запуски лекций переведены на неё.`
        : "Презентация обновлена"
    );
  };

  const deleteMutation = useMutation({
    mutationFn: (slideId: string) => deleteDeckSlide(courseId, deck?.id ?? "", slideId),
    onSuccess: (result) => applyDeckEdit(result),
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось удалить слайд."))
  });
  const reorderMutation = useMutation({
    mutationFn: ({ slideIds }: { slideIds: string[]; targetIndex: number }) =>
      reorderDeckSlides(courseId, deck?.id ?? "", slideIds),
    onSuccess: (result, variables) => applyDeckEdit(result, variables.targetIndex),
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось изменить порядок слайдов."))
  });

  return {
    editing: deleteMutation.isPending || reorderMutation.isPending,
    deleteActiveSlide: () => {
      const slide = deck?.slides[activeIndex];
      if (slide) deleteMutation.mutate(slide.id);
    },
    moveActiveSlide: (direction: -1 | 1) => {
      if (!deck) return;
      const target = activeIndex + direction;
      if (target < 0 || target >= deck.slides.length) return;
      const slideIds = deck.slides.map((slide) => slide.id);
      [slideIds[activeIndex], slideIds[target]] = [slideIds[target], slideIds[activeIndex]];
      reorderMutation.mutate({ slideIds, targetIndex: target });
    }
  };
}
