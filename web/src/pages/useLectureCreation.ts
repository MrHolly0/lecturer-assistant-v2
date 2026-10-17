import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createLecture } from "../app/api/content-api";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";

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
      toast.success("Лекция сохранена");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось сохранить лекцию."))
  });
}
