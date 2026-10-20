import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  archiveDeck,
  deleteLecture,
  hardDeleteDeck,
  hardDeleteLecture,
  restoreDeck,
  restoreLecture
} from "../app/api/content-api";

export function useMaterialsActions(courseId: string, onDeckArchived: () => void) {
  const queryClient = useQueryClient();
  const invalidateDecks = () =>
    queryClient.invalidateQueries({ queryKey: ["content", courseId, "decks"] });
  const invalidateLectures = () =>
    queryClient.invalidateQueries({ queryKey: ["content", courseId, "lectures"] });

  const onError = (error: unknown) =>
    toast.error(userErrorMessage(error, "Не удалось изменить материал. Попробуйте ещё раз."));
  const archiveDeckMut = useMutation({
    onError,
    mutationFn: (deckId: string) => archiveDeck(courseId, deckId),
    onSuccess: () => {
      onDeckArchived();
      void invalidateDecks();
    }
  });
  const restoreDeckMut = useMutation({
    onError,
    mutationFn: (deckId: string) => restoreDeck(courseId, deckId),
    onSuccess: () => void invalidateDecks()
  });
  const hardDeleteDeckMut = useMutation({
    onError,
    mutationFn: (deckId: string) => hardDeleteDeck(courseId, deckId),
    onSuccess: () => void invalidateDecks()
  });
  const deleteLectureMut = useMutation({
    onError,
    mutationFn: (lectureId: string) => deleteLecture(courseId, lectureId),
    onSuccess: () => void invalidateLectures()
  });
  const restoreLectureMut = useMutation({
    onError,
    mutationFn: (lectureId: string) => restoreLecture(courseId, lectureId),
    onSuccess: () => void invalidateLectures()
  });
  const hardDeleteLectureMut = useMutation({
    onError,
    mutationFn: (lectureId: string) => hardDeleteLecture(courseId, lectureId),
    onSuccess: () => void invalidateLectures()
  });
  return {
    archiveDeckMut,
    restoreDeckMut,
    hardDeleteDeckMut,
    deleteLectureMut,
    restoreLectureMut,
    hardDeleteLectureMut
  };
}
