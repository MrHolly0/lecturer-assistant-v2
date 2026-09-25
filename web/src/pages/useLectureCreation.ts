import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createLecture } from "../app/api/content-api";

export function useLectureCreation(
  courseId: string,
  title: string,
  deckId: string,
  onCreated: () => void
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => createLecture(courseId, title.trim(), deckId),
    onSuccess: () => {
      onCreated();
      void qc.invalidateQueries({ queryKey: ["content", courseId, "lectures"] });
    }
  });
}
