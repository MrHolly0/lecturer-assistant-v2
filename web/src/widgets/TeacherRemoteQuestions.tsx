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
  onRetry,
  disabled = false
}: {
  courseId: string;
  sessionId: string;
  questions: StudentQuestion[];
  isLoading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const openQuestions = questions.filter((question) => question.status === "OPEN");
  const selected =
    openQuestions.find((question) => question.id === selectedId) ??
    (!compact ? openQuestions[0] : undefined);
  const answerText = selected ? drafts[selected.id] ?? selected.answerText ?? "" : "";
  const authorLabel = (question: StudentQuestion) =>
    question.anonymous ? "Анонимный вопрос" : question.displayName || "Вопрос студента";
  const updateMutation = useMutation({
    mutationFn: ({
      status,
      answerVisibility
    }: {
      status: "ANSWERED" | "DISMISSED";
      answerVisibility?: "AUTHOR" | "SESSION";
    }) => {
      if (!selected || disabled || loadError) throw new Error("Дождитесь сверки занятия");
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
      setSelectedId(null);
      setPublishConfirmOpen(false);
      toast.success(updated.status === "ANSWERED" ? "Ответ отправлен." : "Вопрос скрыт.");
    },
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось обновить вопрос. Черновик сохранён."))
  });
  const busy = disabled || loadError || updateMutation.isPending;
  const composer = selected && (
    <div className="teacher-question-composer">
      <p className="teacher-question-composer__meta">
        {authorLabel(selected)} · {formatTime(selected.createdAt)}
      </p>
      <h3>{selected.text}</h3>
      <label className="teacher-answer-field">
        <span>Ответ студенту</span>
        <Textarea
          value={answerText}
          maxLength={4000}
          rows={3}
          placeholder="Напишите ответ"
          onChange={(event) =>
            setDrafts((current) => ({ ...current, [selected.id]: event.target.value }))
          }
        />
      </label>
      <p className="question-privacy-hint">Личный ответ увидит только автор.</p>
      <Button
        type="button"
        disabled={busy || !answerText.trim()}
        onClick={() => updateMutation.mutate({ status: "ANSWERED", answerVisibility: "AUTHOR" })}
      >
        <LockKeyhole size={18} aria-hidden="true" />
        Ответить автору
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={busy || !answerText.trim()}
        onClick={() => setPublishConfirmOpen(true)}
      >
        <Globe2 size={18} aria-hidden="true" />
        Показать всем
      </Button>
      <p className="question-privacy-hint">Вопрос и ответ будут опубликованы без имени автора.</p>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => updateMutation.mutate({ status: "DISMISSED" })}
      >
        Скрыть вопрос
      </Button>
    </div>
  );
  return (
    <section className="teacher-remote-section" aria-label="Вопросы студентов">
      <div className="teacher-remote-section__heading">
        <h2>Вопросы студентов</h2>
        <span>
          {openQuestions.length} {pluralizeRu(openQuestions.length, "новый", "новых", "новых")}
        </span>
      </div>
      {loadError && (
        <div className="teacher-remote-data-error" role="alert">
          Не удалось обновить вопросы. {openQuestions.length ? "Показаны последние данные." : ""}{" "}
          <Button type="button" variant="outline" onClick={onRetry}>
            Повторить
          </Button>
        </div>
      )}
      {isLoading ? (
        <div className="teacher-remote-empty">
          <p>Загружаем вопросы…</p>
        </div>
      ) : openQuestions.length === 0 && !loadError ? (
        <div className="teacher-remote-empty">
          <CheckCircle2 size={22} aria-hidden="true" />
          <p>Новых вопросов пока нет.</p>
        </div>
      ) : null}
      {openQuestions.length > 0 && (compact || openQuestions.length > 1) && (
        <ul className="teacher-remote-question-list">
          {openQuestions.map((question) => (
            <li key={question.id}>
              <button
                type="button"
                aria-pressed={selected?.id === question.id}
                onClick={() => setSelectedId(question.id)}
              >
                <MessageCircleQuestion size={19} aria-hidden="true" />
                <span>
                  <strong>{question.text}</strong>
                  <small>
                    {authorLabel(question)} · {formatTime(question.createdAt)}
                  </small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!compact && composer}
      {compact && (
        <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
          <SheetContent side="bottom" className="teacher-question-sheet">
            <SheetHeader>
              <SheetTitle>Ответить на вопрос</SheetTitle>
              <SheetDescription>Выберите, кто увидит ответ.</SheetDescription>
            </SheetHeader>
            {composer}
          </SheetContent>
        </Sheet>
      )}
      <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
        <DialogContent className="teacher-question-publish-dialog">
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
              disabled={busy || !answerText.trim()}
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
