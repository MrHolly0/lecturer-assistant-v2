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

  const archiveDeckMut = useMutation({
    mutationFn: (deckId: string) => archiveDeck(courseId, deckId),
    onSuccess: () => {
      onDeckArchived();
      void invalidateDecks();
    }
  });
  const restoreDeckMut = useMutation({
    mutationFn: (deckId: string) => restoreDeck(courseId, deckId),
    onSuccess: () => void invalidateDecks()
  });
  const hardDeleteDeckMut = useMutation({
    mutationFn: (deckId: string) => hardDeleteDeck(courseId, deckId),
    onSuccess: () => void invalidateDecks()
  });
  const deleteLectureMut = useMutation({
    mutationFn: (lectureId: string) => deleteLecture(courseId, lectureId),
    onSuccess: () => void invalidateLectures()
  });
  const restoreLectureMut = useMutation({
    mutationFn: (lectureId: string) => restoreLecture(courseId, lectureId),
    onSuccess: () => void invalidateLectures()
  });
  const hardDeleteLectureMut = useMutation({
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
