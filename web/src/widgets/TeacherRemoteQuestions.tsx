import { CheckCircle2, ChevronRight, MessageCircleQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import { updateStudentQuestion, type StudentQuestion } from "../app/api/student-api";
import { pluralizeRu } from "../shared/lib/plural";
import { Button } from "../shared/ui/button";
import { Textarea } from "../shared/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../shared/ui/sheet";

export function TeacherRemoteQuestions({
  courseId,
  sessionId,
  questions
}: {
  courseId: string;
  sessionId: string;
  questions: StudentQuestion[];
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<StudentQuestion | null>(null);
  const [answerText, setAnswerText] = useState("");
  const openQuestions = questions.filter((question) => question.status === "OPEN");
  const updateMutation = useMutation({
    mutationFn: (status: "ANSWERED" | "DISMISSED") => {
      if (!selected) throw new Error("Вопрос не выбран");
      return updateStudentQuestion(courseId, sessionId, selected.id, {
        status,
        answerText: status === "ANSWERED" ? answerText.trim() || null : null
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["live", courseId, sessionId, "engagement"],
        (current: { questions: StudentQuestion[] } | undefined) =>
          current
            ? {
                ...current,
                questions: current.questions.map((question) =>
                  question.id === updated.id ? updated : question
                )
              }
            : current
      );
      setSelected(null);
      toast.success(updated.status === "ANSWERED" ? "Вопрос отмечен отвеченным." : "Вопрос скрыт.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось обновить вопрос."))
  });

  useEffect(() => setAnswerText(selected?.answerText ?? ""), [selected]);

  return (
    <section className="teacher-remote-section" aria-labelledby="remote-questions-title">
      <div className="teacher-remote-section__heading">
        <h2 id="remote-questions-title">Вопросы студентов</h2>
        <span>
          {openQuestions.length} {pluralizeRu(openQuestions.length, "новый", "новых", "новых")}
        </span>
      </div>
      {openQuestions.length === 0 ? (
        <div className="teacher-remote-empty">
          <CheckCircle2 size={22} aria-hidden="true" />
          <p>Новых вопросов пока нет.</p>
        </div>
      ) : (
        <ul className="teacher-remote-question-list">
          {openQuestions.map((question) => (
            <li key={question.id}>
              <button type="button" onClick={() => setSelected(question)}>
                <MessageCircleQuestion size={19} aria-hidden="true" />
                <span>
                  <strong>{question.text}</strong>
                  <small>
                    {question.displayName} · {formatTime(question.createdAt)}
                  </small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom" className="teacher-question-sheet">
          <SheetHeader>
            <SheetTitle>{selected?.displayName ?? "Вопрос студента"}</SheetTitle>
            <SheetDescription>{selected ? formatTime(selected.createdAt) : ""}</SheetDescription>
          </SheetHeader>
          <div className="teacher-question-sheet__body">
            <p>{selected?.text}</p>
            <label className="field">
              <span>Короткий ответ (необязательно)</span>
              <Textarea
                value={answerText}
                maxLength={4000}
                rows={3}
                placeholder="Что вы ответили аудитории"
                onChange={(event) => setAnswerText(event.target.value)}
              />
            </label>
            <div className="teacher-question-sheet__actions">
              <Button
                type="button"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate("ANSWERED")}
              >
                <CheckCircle2 size={17} aria-hidden="true" /> Ответ дан
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate("DISMISSED")}
              >
                Скрыть вопрос
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
