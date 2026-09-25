import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteSlideNote, saveSlideNote, type SlideDeckDetails } from "../app/api/content-api";
import { userErrorMessage } from "../app/api/errors";

export function useSlideNoteActions(
  courseId: string,
  deck: SlideDeckDetails | undefined,
  activeIndex: number
) {
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["content", courseId, "decks", deck?.id ?? ""] });
  const save = useMutation({
    mutationFn: (content: string) =>
      saveSlideNote(courseId, deck?.id ?? "", deck?.slides[activeIndex]?.idx ?? 1, content),
    onSuccess: () => {
      toast.success("Заметка сохранена");
      void refresh();
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось сохранить заметку."))
  });
  const clear = useMutation({
    mutationFn: () =>
      deleteSlideNote(courseId, deck?.id ?? "", deck?.slides[activeIndex]?.idx ?? 1),
    onSuccess: () => {
      toast.success("Заметка очищена");
      void refresh();
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось очистить заметку."))
  });
  return { saving: save.isPending, save: save.mutateAsync, clear: clear.mutate };
}
