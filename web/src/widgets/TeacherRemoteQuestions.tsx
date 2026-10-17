import {
  CheckCircle2,
  ChevronRight,
  Globe2,
  LockKeyhole,
  MessageCircleQuestion
} from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import { updateStudentQuestion, type StudentQuestion } from "../app/api/student-api";
import { pluralizeRu } from "../shared/lib/plural";
import { Button } from "../shared/ui/button";
import { Textarea } from "../shared/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../shared/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";

export function TeacherRemoteQuestions({
  courseId,
  sessionId,
  questions,
  isLoading = false,
  loadError = false,
  onRetry
}: {
  courseId: string;
  sessionId: string;
  questions: StudentQuestion[];
  isLoading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<StudentQuestion | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const openQuestions = questions.filter((question) => question.status === "OPEN");
  const updateMutation = useMutation({
    mutationFn: ({
      status,
      answerVisibility
    }: {
      status: "ANSWERED" | "DISMISSED";
      answerVisibility?: "AUTHOR" | "SESSION";
    }) => {
      if (!selected) throw new Error("Вопрос не выбран");
      return updateStudentQuestion(courseId, sessionId, selected.id, {
        status,
        ...(status === "ANSWERED" ? { answerText: answerText.trim(), answerVisibility } : {})
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
      setPublishConfirmOpen(false);
      toast.success(updated.status === "ANSWERED" ? "Ответ отправлен." : "Вопрос скрыт.");
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
      {loadError && openQuestions.length > 0 && (
        <div className="teacher-remote-data-error" role="status">
          Не удалось обновить список. Показаны последние данные.{" "}
          <button type="button" onClick={onRetry}>
            Повторить
          </button>
        </div>
      )}
      {loadError && openQuestions.length === 0 ? (
        <div className="teacher-remote-empty teacher-remote-data-error" role="alert">
          <p>Не удалось загрузить вопросы.</p>
          <Button type="button" variant="outline" onClick={onRetry}>
            Повторить
          </Button>
        </div>
      ) : isLoading ? (
        <div className="teacher-remote-empty">
          <p>Загружаем вопросы…</p>
        </div>
      ) : openQuestions.length === 0 ? (
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
              <span>Ответ студенту</span>
              <Textarea
                value={answerText}
                maxLength={4000}
                rows={3}
                placeholder="Напишите ответ"
                onChange={(event) => setAnswerText(event.target.value)}
              />
            </label>
            <div className="teacher-question-sheet__actions">
              <p className="question-privacy-hint">
                Личный ответ увидит только автор. При ответе всем аудитория увидит вопрос и ответ
                без имени автора.
              </p>
              <Button
                type="button"
                disabled={updateMutation.isPending || !answerText.trim()}
                onClick={() =>
                  updateMutation.mutate({ status: "ANSWERED", answerVisibility: "AUTHOR" })
                }
              >
                <LockKeyhole size={17} aria-hidden="true" /> Ответить автору
              </Button>
              <Button
                type="button"
                disabled={updateMutation.isPending || !answerText.trim()}
                onClick={() => setPublishConfirmOpen(true)}
              >
                <Globe2 size={17} aria-hidden="true" /> Показать всем
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({ status: "DISMISSED" })}
              >
                Скрыть вопрос
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Опубликовать вопрос и ответ?</DialogTitle>
            <DialogDescription>
              Участники занятия увидят вопрос и этот ответ. Имя автора не будет показано.
            </DialogDescription>
          </DialogHeader>
          <div className="teacher-question-public-preview">
            <strong>Вопрос</strong>
            <p>{selected?.text}</p>
            <strong>Ответ</strong>
            <p>{answerText}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPublishConfirmOpen(false)}>
              Вернуться к ответу
            </Button>
            <Button
              type="button"
              disabled={updateMutation.isPending || !answerText.trim()}
              onClick={() =>
                updateMutation.mutate({ status: "ANSWERED", answerVisibility: "SESSION" })
              }
            >
              Опубликовать для участников
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
