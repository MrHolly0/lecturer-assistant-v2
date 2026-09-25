import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  archiveDeck,
  deleteLecture,
  hardDeleteDeck,
  hardDeleteLecture,
  restoreDeck,
  restoreLecture
} from "../app/api/content-api";
import { startLiveSession } from "../app/api/live-api";

export function useMaterialsActions(courseId: string, onDeckArchived: () => void) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [startingLectureId, setStartingLectureId] = useState("");
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
  const startSessionMut = useMutation({
    mutationFn: (lectureId: string) => startLiveSession(courseId, lectureId),
    onMutate: (lectureId) => setStartingLectureId(lectureId),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      navigate(`/courses/${courseId}/sessions/${session.id}/join`);
    },
    onSettled: () => setStartingLectureId("")
  });

  return {
    archiveDeckMut,
    restoreDeckMut,
    hardDeleteDeckMut,
    deleteLectureMut,
    restoreLectureMut,
    hardDeleteLectureMut,
    startSessionMut,
    startingLectureId
  };
}
