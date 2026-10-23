import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createLecture } from "../app/api/content-api";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import { useRef } from "react";
import { PendingOperationKey } from "../app/api/operation-key";

export function useLectureCreation(
  courseId: string,
  title: string,
  deckId: string,
  onCreated: () => void
) {
  const qc = useQueryClient();
  const pendingCreate = useRef(new PendingOperationKey());
  return useMutation({
    mutationFn: () =>
      pendingCreate.current.run({ courseId, title: title.trim(), deckId }, (key) =>
        createLecture(courseId, title.trim(), deckId, key)
      ),
    onSuccess: () => {
      onCreated();
      void qc.invalidateQueries({ queryKey: ["content", courseId, "lectures"] });
      toast.success("Лекция сохранена");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось сохранить лекцию."))
  });
}
