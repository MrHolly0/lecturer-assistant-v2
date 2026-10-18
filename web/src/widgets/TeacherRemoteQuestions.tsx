import { CheckCircle2, Globe2, LockKeyhole, MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import {
  getSessionQuestionsPage,
  updateStudentQuestion,
  type StudentQuestion
} from "../app/api/student-api";
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
  const [filter, setFilter] = useState<StudentQuestion["status"]>("OPEN");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [sectionVisible, setSectionVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState === "visible"
  );
  const sectionRef = useRef<HTMLElement>(null);
  const actionButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const filterButtonsRef = useRef(new Map<StudentQuestion["status"], HTMLButtonElement>());
  const sheetReturnFocusIdRef = useRef<string | null>(null);
  const countsRef = useRef<{
    scope: string;
    counts: { open: number; answered: number; dismissed: number };
  } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const element = sectionRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setSectionVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const questionsQuery = useInfiniteQuery({
    queryKey: ["live", courseId, sessionId, "questions", filter],
    queryFn: ({ pageParam }) => getSessionQuestionsPage(courseId, sessionId, filter, 50, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.offset + lastPage.items.length < lastPage.total
        ? lastPage.offset + lastPage.items.length
        : undefined,
    refetchInterval: sectionVisible && documentVisible ? 3000 : false,
    refetchIntervalInBackground: false
  });
  const questionPages = questionsQuery.data?.pages ?? [];
  const filteredQuestions = Array.from(
    new Map(
      questionPages.flatMap((page) => page.items).map((question) => [question.id, question])
    ).values()
  );
  const questionScope = `${courseId}:${sessionId}`;
  const pageCounts = questionPages[0]?.counts;
  if (pageCounts) countsRef.current = { scope: questionScope, counts: pageCounts };
  const serverCounts =
    pageCounts ??
    (countsRef.current?.scope === questionScope ? countsRef.current.counts : undefined);
  const counts = {
    OPEN: serverCounts?.open ?? questions.length,
    ANSWERED: serverCounts?.answered ?? 0,
    DISMISSED: serverCounts?.dismissed ?? 0
  };
  const selected = filteredQuestions.find((question) => question.id === selectedId);
  const selectedOpenQuestion = selected?.status === "OPEN" ? selected : undefined;
  const answerText = selectedOpenQuestion
    ? drafts[selectedOpenQuestion.id] ?? selectedOpenQuestion.answerText ?? ""
    : "";
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
      if (!selectedOpenQuestion || disabled) throw new Error("Вопрос пока недоступен для ответа");
      return updateStudentQuestion(courseId, sessionId, selectedOpenQuestion.id, {
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
      void queryClient.invalidateQueries({
        queryKey: ["live", courseId, sessionId, "questions"]
      });
      setSelectedId(null);
      setPublishConfirmOpen(false);
      if (!compact) filterButtonsRef.current.get(filter)?.focus({ preventScroll: true });
      toast.success(updated.status === "ANSWERED" ? "Ответ отправлен." : "Вопрос скрыт.");
    },
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось обновить вопрос. Черновик сохранён."))
  });
  const busy = disabled || updateMutation.isPending;
  const composer = selectedOpenQuestion && (
    <div
      id={`teacher-question-composer-${selectedOpenQuestion.id}`}
      className="teacher-question-composer"
    >
      <p className="teacher-question-composer__meta">
        {authorLabel(selectedOpenQuestion)} · {formatTime(selectedOpenQuestion.createdAt)}
      </p>
      <h3>{selectedOpenQuestion.text}</h3>
      <label className="teacher-answer-field">
        <span>Ответ студенту</span>
        <Textarea
          value={answerText}
          maxLength={4000}
          rows={3}
          placeholder="Напишите ответ"
          onChange={(event) =>
            setDrafts((current) => ({ ...current, [selectedOpenQuestion.id]: event.target.value }))
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
      {compact && (
        <Button type="button" variant="outline" onClick={() => setSelectedId(null)}>
          Свернуть
        </Button>
      )}
    </div>
  );
  const sheetOpen = compact && Boolean(composer);
  const countsByStatus: Array<{ status: StudentQuestion["status"]; label: string }> = [
    { status: "OPEN", label: "Новые" },
    { status: "ANSWERED", label: "Отвеченные" },
    { status: "DISMISSED", label: "Скрытые" }
  ];
  const totalQuestions = counts.OPEN + counts.ANSWERED + counts.DISMISSED;
  return (
    <section ref={sectionRef} className="teacher-remote-section" aria-label="Вопросы студентов">
      <div className="teacher-remote-section__heading">
        <h2>Вопросы студентов</h2>
        <span>
          {totalQuestions} {pluralizeRu(totalQuestions, "вопрос", "вопроса", "вопросов")}
        </span>
      </div>
      {loadError && (
        <div className="teacher-remote-data-error" role="alert">
          Не удалось обновить сводку занятия.{" "}
          {questions.length ? "Сохранены последние данные." : ""}{" "}
          <Button type="button" variant="outline" onClick={onRetry}>
            Повторить
          </Button>
        </div>
      )}
      {questionsQuery.isError && (
        <div className="teacher-remote-data-error" role="alert">
          Не удалось обновить список вопросов.
          {filteredQuestions.length > 0 ? " Показаны последние данные." : ""}{" "}
          <Button type="button" variant="outline" onClick={() => void questionsQuery.refetch()}>
            Повторить
          </Button>
        </div>
      )}
      {questionsQuery.isLoading ? (
        <div className="teacher-remote-empty">
          <p>Загружаем вопросы…</p>
        </div>
      ) : null}
      {!questionsQuery.isLoading && !questionsQuery.isError && totalQuestions === 0 ? (
        <div className="teacher-remote-empty">
          <CheckCircle2 size={22} aria-hidden="true" />
          <p>Вопросов пока нет.</p>
        </div>
      ) : null}
      {totalQuestions > 0 && (
        <div className="presenter-question-filters" role="group" aria-label="Фильтр вопросов">
          {countsByStatus.map(({ status, label }) => (
            <Button
              key={status}
              ref={(node) => {
                if (node) filterButtonsRef.current.set(status, node);
                else filterButtonsRef.current.delete(status);
              }}
              type="button"
              variant={filter === status ? "secondary" : "ghost"}
              aria-pressed={filter === status}
              onClick={() => {
                setFilter(status);
                setSelectedId(null);
              }}
            >
              {label} <span>{counts[status]}</span>
            </Button>
          ))}
        </div>
      )}
      {filteredQuestions.length > 0 ? (
        <ul className="teacher-remote-question-list">
          {filteredQuestions.map((question) => {
            const expanded = selectedId === question.id;
            const isOpen = question.status === "OPEN";
            const actionLabel = expanded
              ? "Свернуть"
              : isOpen
                ? "Ответить"
                : question.status === "ANSWERED"
                  ? "Показать ответ"
                  : "Просмотреть";
            return (
              <li key={question.id}>
                <div className="teacher-remote-question-item">
                  <div className="teacher-remote-question-item__summary">
                    <MessageCircleQuestion size={19} aria-hidden="true" />
                    <span>
                      <strong>{question.text}</strong>
                      <small>
                        {authorLabel(question)} · {formatTime(question.createdAt)}
                      </small>
                    </span>
                  </div>
                  <Button
                    ref={(node) => {
                      if (node) actionButtonsRef.current.set(question.id, node);
                      else actionButtonsRef.current.delete(question.id);
                    }}
                    type="button"
                    variant="outline"
                    aria-expanded={expanded}
                    aria-controls={
                      expanded
                        ? isOpen
                          ? `teacher-question-composer-${question.id}`
                          : `presenter-question-record-${question.id}`
                        : undefined
                    }
                    onClick={() => {
                      if (expanded) {
                        setSelectedId(null);
                        return;
                      }
                      if (isOpen && compact) sheetReturnFocusIdRef.current = question.id;
                      setSelectedId(question.id);
                    }}
                  >
                    {actionLabel}
                  </Button>
                </div>
                {!compact && expanded && isOpen && composer}
                {expanded && !isOpen && <QuestionRecordDetails question={question} />}
              </li>
            );
          })}
        </ul>
      ) : totalQuestions > 0 && !questionsQuery.isLoading ? (
        <div className="teacher-remote-empty">
          <p>
            Нет вопросов в разделе «{countsByStatus.find((item) => item.status === filter)?.label}».
          </p>
        </div>
      ) : null}
      {questionsQuery.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          className="presenter-question-load-more"
          disabled={questionsQuery.isFetchingNextPage}
          onClick={() => void questionsQuery.fetchNextPage()}
        >
          {questionsQuery.isFetchingNextPage ? "Загружаем…" : "Показать ещё вопросы"}
        </Button>
      )}
      {compact && (
        <Sheet open={sheetOpen} onOpenChange={(open) => !open && setSelectedId(null)}>
          <SheetContent
            side="bottom"
            className="teacher-question-sheet"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const questionId = sheetReturnFocusIdRef.current;
              const returnTarget = questionId
                ? actionButtonsRef.current.get(questionId)
                : undefined;
              (returnTarget ?? filterButtonsRef.current.get("OPEN"))?.focus({
                preventScroll: true
              });
              sheetReturnFocusIdRef.current = null;
            }}
          >
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

function QuestionRecordDetails({ question }: { question: StudentQuestion }) {
  const visibility =
    question.answerVisibility === "AUTHOR"
      ? "Личный ответ, виден только автору."
      : question.answerVisibility === "SESSION"
        ? "Опубликован участникам занятия без имени автора."
        : null;

  return (
    <div
      id={`presenter-question-record-${question.id}`}
      className="presenter-question-record-details"
    >
      <p className="presenter-question-record-details__status">
        {question.status === "ANSWERED" ? "Ответ отправлен" : "Вопрос скрыт"}
      </p>
      {question.answerText ? (
        <>
          <h3>Ответ преподавателя</h3>
          <p className="presenter-question-record-details__answer">{question.answerText}</p>
          {visibility && <p className="question-privacy-hint">{visibility}</p>}
        </>
      ) : (
        <p className="question-privacy-hint">Для этого вопроса нет опубликованного ответа.</p>
      )}
      {question.answeredAt && <small>Дата ответа: {formatTime(question.answeredAt)}</small>}
    </div>
  );
}
