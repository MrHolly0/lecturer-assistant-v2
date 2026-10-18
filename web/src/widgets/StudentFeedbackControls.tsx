import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Check,
  EyeOff,
  MessageSquareText,
  Smile,
  TriangleAlert,
  CircleX,
  ChevronRight,
  LockKeyhole,
  X
} from "lucide-react";
import { toast } from "sonner";
import type { SignalValue, StudentQuestion, StudentQuestionAnswer } from "../app/api/student-api";
import { pluralizeRu } from "../shared/lib/plural";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "../shared/ui/dialog";
import { StudentQuestionAnswers } from "./StudentQuestionAnswers";

const SIGNALS: Array<{ value: SignalValue; label: string; icon: typeof Smile }> = [
  { value: "GREEN", label: "Понятно", icon: Smile },
  { value: "YELLOW", label: "Есть вопрос", icon: TriangleAlert },
  { value: "RED", label: "Не понимаю", icon: CircleX }
];

interface StudentFeedbackControlsProps {
  readOnly?: boolean;
  isLive: boolean;
  isSignalPending: boolean;
  isQuestionPending: boolean;
  lastSignal: SignalValue | null;
  question: string;
  anonymous: boolean;
  questions: StudentQuestion[];
  answers: StudentQuestionAnswer[];
  onSignal: (value: SignalValue) => void;
  onQuestionChange: (value: string) => void;
  onQuestionSubmit: () => void;
  questionError?: boolean;
  onAnonymousChange: (value: boolean) => void;
  unavailableMessage?: string;
  restoreFocusOnClose?: boolean;
}

interface VisualViewportMetrics {
  height: number;
  offsetTop: number;
}

export function StudentFeedbackControls(props: StudentFeedbackControlsProps) {
  const [questionOpen, setQuestionOpen] = useState(false);
  const [viewportMetrics, setViewportMetrics] = useState<VisualViewportMetrics | null>(null);
  const [unreadAnswerCount, setUnreadAnswerCount] = useState(0);
  const [answerAnnouncement, setAnswerAnnouncement] = useState("");
  const questionsOpenRef = useRef(false);
  const questionTriggerRef = useRef<HTMLButtonElement>(null);
  const questionTitleRef = useRef<HTMLHeadingElement>(null);
  const questionScrollTopRef = useRef(0);
  const questionViewportHeightRef = useRef(0);
  const questionViewportWidthRef = useRef(0);
  const viewportRestoreCleanupRef = useRef<(() => void) | null>(null);
  const questionPendingRef = useRef(props.isQuestionPending);
  const seenAnswersRef = useRef(
    new Map(props.answers.map((answer) => [answer.questionId, answer.answerText]))
  );
  useEffect(() => {
    const wasPending = questionPendingRef.current;
    questionPendingRef.current = props.isQuestionPending;
    if (
      questionOpen &&
      wasPending &&
      !props.isQuestionPending &&
      !props.question &&
      !props.questionError
    ) {
      setQuestionOpen(false);
    }
  }, [props.isQuestionPending, props.question, props.questionError, questionOpen]);
  useEffect(() => {
    if (!questionOpen) return;
    const viewport = window.visualViewport;
    const updateMetrics = () => {
      setViewportMetrics({
        height: viewport?.height ?? window.innerHeight,
        offsetTop: viewport?.offsetTop ?? 0
      });
    };
    updateMetrics();
    window.addEventListener("resize", updateMetrics);
    viewport?.addEventListener("resize", updateMetrics);
    viewport?.addEventListener("scroll", updateMetrics);
    return () => {
      window.removeEventListener("resize", updateMetrics);
      viewport?.removeEventListener("resize", updateMetrics);
      viewport?.removeEventListener("scroll", updateMetrics);
    };
  }, [questionOpen]);
  useEffect(
    () => () => {
      viewportRestoreCleanupRef.current?.();
    },
    []
  );
  useEffect(() => {
    const newlyReceived: StudentQuestionAnswer[] = [];
    let updatedCount = 0;
    for (const answer of props.answers) {
      const previousText = seenAnswersRef.current.get(answer.questionId);
      if (previousText === undefined) newlyReceived.push(answer);
      else if (previousText !== answer.answerText) updatedCount += 1;
      seenAnswersRef.current.set(answer.questionId, answer.answerText);
    }
    if (newlyReceived.length > 0) {
      if (!questionsOpenRef.current) {
        setUnreadAnswerCount((count) => count + newlyReceived.length);
      }
      const message =
        newlyReceived.length === 1
          ? "Получен новый ответ преподавателя. Откройте раздел «Мои вопросы и ответы»."
          : `Получено ${newlyReceived.length} новых ответов преподавателя. Откройте раздел «Мои вопросы и ответы».`;
      setAnswerAnnouncement(message);
      toast.info(message);
    } else if (updatedCount > 0) {
      const message = "Преподаватель обновил ответ. Откройте раздел «Мои вопросы и ответы».";
      setAnswerAnnouncement(message);
      toast.info(message);
    }
  }, [props.answers]);
  const unansweredQuestions = props.questions.filter(
    (question) => !props.answers.some((answer) => answer.questionId === question.id)
  );
  function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (props.question.trim()) props.onQuestionSubmit();
  }

  function openQuestionDialog() {
    viewportRestoreCleanupRef.current?.();
    viewportRestoreCleanupRef.current = null;
    questionScrollTopRef.current = window.scrollY;
    questionViewportHeightRef.current = window.visualViewport?.height ?? window.innerHeight;
    questionViewportWidthRef.current = window.visualViewport?.width ?? window.innerWidth;
    setViewportMetrics(null);
    setQuestionOpen(true);
  }

  function handleQuestionOpenChange(open: boolean) {
    if (open) {
      if (!questionOpen) {
        viewportRestoreCleanupRef.current?.();
        viewportRestoreCleanupRef.current = null;
        questionScrollTopRef.current = window.scrollY;
        questionViewportHeightRef.current = window.visualViewport?.height ?? window.innerHeight;
        questionViewportWidthRef.current = window.visualViewport?.width ?? window.innerWidth;
      }
      setViewportMetrics(null);
    }
    setQuestionOpen(open);
  }

  function restoreQuestionPagePosition() {
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - document.documentElement.clientHeight
    );
    window.scrollTo(0, Math.min(questionScrollTopRef.current, maxScroll));
  }

  function restoreFocusAndPagePosition() {
    questionTriggerRef.current?.focus({ preventScroll: true });
    restoreQuestionPagePosition();
    window.requestAnimationFrame(restoreQuestionPagePosition);

    const viewport = window.visualViewport;
    const expectedHeight = questionViewportHeightRef.current;
    const expectedWidth = questionViewportWidthRef.current;
    if (!viewport || viewport.height >= expectedHeight - 64) return;

    const restoreAfterKeyboardCloses = () => {
      if (Math.abs(viewport.width - expectedWidth) > 1) {
        cleanup();
        viewportRestoreCleanupRef.current = null;
        return;
      }
      if (viewport.height < expectedHeight - 64) return;
      cleanup();
      viewportRestoreCleanupRef.current = null;
      window.requestAnimationFrame(restoreQuestionPagePosition);
    };
    const cancelRestoreAfterInteraction = () => {
      cleanup();
      viewportRestoreCleanupRef.current = null;
    };
    const cancelRestoreAfterOrientation = () => {
      cleanup();
      viewportRestoreCleanupRef.current = null;
    };
    const cleanup = () => {
      viewport.removeEventListener("resize", restoreAfterKeyboardCloses);
      viewport.removeEventListener("scroll", restoreAfterKeyboardCloses);
      window.removeEventListener("resize", restoreAfterKeyboardCloses);
      window.removeEventListener("orientationchange", cancelRestoreAfterOrientation);
      window.removeEventListener("pointerdown", cancelRestoreAfterInteraction);
      window.removeEventListener("touchstart", cancelRestoreAfterInteraction);
      window.removeEventListener("wheel", cancelRestoreAfterInteraction);
      window.removeEventListener("keydown", cancelRestoreAfterInteraction);
    };
    viewportRestoreCleanupRef.current?.();
    viewportRestoreCleanupRef.current = cleanup;
    viewport.addEventListener("resize", restoreAfterKeyboardCloses);
    viewport.addEventListener("scroll", restoreAfterKeyboardCloses);
    window.addEventListener("resize", restoreAfterKeyboardCloses);
    window.addEventListener("orientationchange", cancelRestoreAfterOrientation);
    window.addEventListener("pointerdown", cancelRestoreAfterInteraction);
    window.addEventListener("touchstart", cancelRestoreAfterInteraction, { passive: true });
    window.addEventListener("wheel", cancelRestoreAfterInteraction, { passive: true });
    window.addEventListener("keydown", cancelRestoreAfterInteraction);
  }

  const dialogViewportStyle: CSSProperties | undefined = viewportMetrics
    ? ({
        "--student-question-vv-height": `${viewportMetrics.height}px`,
        "--student-question-vv-center": `${viewportMetrics.offsetTop + viewportMetrics.height / 2}px`
      } as CSSProperties)
    : undefined;

  return (
    <>
      {!props.readOnly && (
        <>
          <div className="section-heading">
            <h2>Сигнал преподавателю</h2>
          </div>
          {!props.isLive && (
            <p className="student-signal-unavailable muted">
              {props.unavailableMessage ??
                "Сигналы доступны во время показа при подтверждённой связи."}
            </p>
          )}
          <div className="student-signal-grid">
            {SIGNALS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={[
                  "student-signal-btn",
                  `student-signal-btn--${item.value.toLowerCase()}`,
                  props.lastSignal === item.value ? "student-signal-btn--selected" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={!props.isLive || props.isSignalPending}
                aria-pressed={props.lastSignal === item.value}
                onClick={() => props.onSignal(item.value)}
              >
                <item.icon size={18} aria-hidden="true" />
                <strong>
                  {props.lastSignal === item.value && <Check size={16} aria-hidden="true" />}
                  {item.label}
                </strong>
                <span>
                  {props.lastSignal === item.value ? "Сигнал отправлен" : "Отправить сигнал"}
                </span>
              </button>
            ))}
          </div>

          <section className="student-question-entry">
            <Button
              ref={questionTriggerRef}
              type="button"
              variant="outline"
              aria-haspopup="dialog"
              aria-expanded={questionOpen}
              onClick={openQuestionDialog}
            >
              <MessageSquareText size={17} aria-hidden="true" /> Задать вопрос
              <ChevronRight size={20} aria-hidden="true" />
            </Button>
            <Dialog open={questionOpen} onOpenChange={handleQuestionOpenChange}>
              <DialogContent
                className="student-question-dialog"
                data-short-viewport={
                  viewportMetrics && viewportMetrics.height < 340 ? "true" : undefined
                }
                style={dialogViewportStyle}
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  questionTitleRef.current?.focus({ preventScroll: true });
                }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  if (props.restoreFocusOnClose !== false) restoreFocusAndPagePosition();
                }}
              >
                <div className="student-question-dialog__header">
                  <div>
                    <DialogTitle asChild>
                      <h2 ref={questionTitleRef} tabIndex={-1}>
                        Задать вопрос
                      </h2>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                      Вопрос будет отправлен преподавателю занятия.
                    </DialogDescription>
                  </div>
                  <DialogClose asChild>
                    <button
                      type="button"
                      className="student-question-dialog__close"
                      aria-label="Закрыть форму вопроса"
                    >
                      <X size={18} aria-hidden="true" />
                      <span className="sr-only">Закрыть форму вопроса</span>
                    </button>
                  </DialogClose>
                </div>
                <form onSubmit={submitQuestion} className="student-question-form">
                  <div className="student-question-dialog__body">
                    <label htmlFor="student-question">Ваш вопрос</label>
                    <textarea
                      id="student-question"
                      value={props.question}
                      onChange={(event) => props.onQuestionChange(event.target.value)}
                      placeholder="Напишите вопрос преподавателю"
                      maxLength={1000}
                      rows={3}
                      aria-describedby="question-audience-hint"
                    />
                    <label className="question-anonymous-option">
                      <input
                        type="checkbox"
                        checked={props.anonymous}
                        onChange={(event) => props.onAnonymousChange(event.target.checked)}
                        disabled={props.isQuestionPending}
                      />
                      <EyeOff size={17} aria-hidden="true" />
                      Спросить анонимно
                    </label>
                    <p id="question-audience-hint" className="question-privacy-hint">
                      {props.anonymous
                        ? "Преподаватель и участники не увидят имя. Аккаунт нужен для доставки личного ответа."
                        : "Ваше имя видно преподавателю и сотрудникам занятия. При публикации ответа для всех имя будет скрыто."}
                    </p>
                    {props.questionError && (
                      <p className="student-question-error" role="alert">
                        Не удалось отправить вопрос. Черновик сохранён. Проверьте связь и нажмите
                        «Отправить» ещё раз.
                      </p>
                    )}
                  </div>
                  <footer className="student-question-dialog__footer">
                    <Button
                      type="submit"
                      disabled={!props.isLive || props.isQuestionPending || !props.question.trim()}
                    >
                      <MessageSquareText size={16} aria-hidden="true" />
                      {props.isQuestionPending
                        ? "Отправляем вопрос…"
                        : props.anonymous
                          ? "Отправить анонимно"
                          : "Отправить с именем"}
                    </Button>
                  </footer>
                </form>
              </DialogContent>
            </Dialog>
          </section>
        </>
      )}

      <details
        className="student-my-questions"
        onToggle={(event) => {
          questionsOpenRef.current = event.currentTarget.open;
          if (event.currentTarget.open) {
            setUnreadAnswerCount(0);
            setAnswerAnnouncement("");
          }
        }}
      >
        <summary>
          <LockKeyhole size={20} aria-hidden="true" />
          <span className="student-my-questions__label">Мои вопросы и ответы</span>
          <ChevronRight className="student-my-questions__arrow" size={20} aria-hidden="true" />
          <span className="student-my-questions__summary-meta" aria-live="polite">
            <span>
              {props.questions.length}{" "}
              {pluralizeRu(props.questions.length, "вопрос", "вопроса", "вопросов")}
            </span>
            <span>
              {props.answers.length}{" "}
              {pluralizeRu(
                props.answers.length,
                "ответ преподавателя",
                "ответа преподавателя",
                "ответов преподавателя"
              )}
            </span>
            {unreadAnswerCount > 0 && (
              <span className="student-my-questions__new-count">Новых: {unreadAnswerCount}</span>
            )}
          </span>
        </summary>
        <p className="student-my-questions__announcement" role="status" aria-live="polite">
          {answerAnnouncement}
        </p>
        <StudentQuestionAnswers answers={props.answers} />
        {unansweredQuestions.length > 0 ? (
          <section className="student-pending-questions" aria-labelledby="student-pending-title">
            <h3 id="student-pending-title">
              Ожидают ответа <span>{unansweredQuestions.length}</span>
            </h3>
            <ul className="student-question-list">
              {unansweredQuestions.map((item) => (
                <li key={item.id}>
                  <span>{item.text}</span>
                  {item.anonymous && <small>Анонимно</small>}
                  <small>{new Date(item.createdAt).toLocaleTimeString("ru-RU")}</small>
                </li>
              ))}
            </ul>
          </section>
        ) : props.answers.length === 0 ? (
          <p className="muted">Отправленные вопросы и ответы преподавателя появятся здесь.</p>
        ) : null}
      </details>
    </>
  );
}
