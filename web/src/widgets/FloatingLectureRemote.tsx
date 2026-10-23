import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal, flushSync } from "react-dom";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle,
  PanelTopOpen,
  PanelTopClose,
  X,
  Pause,
  Play,
  Presentation,
  MonitorUp,
  Square,
  LockKeyhole,
  Globe2
} from "lucide-react";
import { toast, Toaster } from "sonner";
import {
  getSessionQuestionsPage,
  getStudentEngagement,
  updateStudentQuestion,
  type StudentQuestion
} from "../app/api/student-api";
import { endLiveSession, type LiveSession } from "../app/api/live-api";
import { userErrorMessage } from "../app/api/errors";
import { BrandMark } from "../shared/brand/BrandMark";
import { Button } from "../shared/ui/button";
import { screenShare } from "../app/sharing/screenShare";
import { closePublicProjection } from "../app/projection/browserProjection";
import { formatSessionTime, useSessionTimers } from "../app/live/useSessionTimers";
import { LectureRemoteTools, type LectureRemoteSection } from "./LectureRemoteTools";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { useSlideNoteDrafts } from "../app/live/useSlideNoteDrafts";
import {
  prepareLectureRemoteWindow,
  resizeLectureRemoteWindow,
  lectureRemoteCollapsed,
  rememberLectureRemoteCollapsed
} from "../app/projection/lectureRemoteWindow";
import "../styles/lecture-remote-window.css";

export function FloatingLectureRemote({
  courseId,
  session,
  disabled,
  onPause,
  onResume,
  onChooseSource,
  onSessionChange,
  onClose,
  initialWindow
}: {
  courseId: string;
  session: LiveSession;
  disabled: boolean;
  onPause: () => void;
  onResume: () => void;
  onChooseSource?: () => void;
  onSessionChange?: (session: LiveSession) => void;
  onClose: () => void;
  initialWindow?: Window | null;
}) {
  const [collapsed, setCollapsed] = useState(() => lectureRemoteCollapsed(session.id));
  const [external, setExternal] = useState<Window | null>(() =>
    initialWindow && !initialWindow.closed ? initialWindow : null
  );
  const [filter, setFilter] = useState<StudentQuestion["status"]>("OPEN");
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const { drafts: noteDrafts, updateDraft: changeNoteDraft } = useSlideNoteDrafts(
    courseId,
    session.deckId
  );
  const [publishing, setPublishing] = useState(false);
  const [section, setSection] = useState<LectureRemoteSection>("questions");
  const controller = screenShare;
  const share = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const sharing = share.scope?.sessionId === session.id && share.phase === "publishing";
  const { elapsed } = useSessionTimers(session);
  const externalRef = useRef<Window | null>(initialWindow ?? null);
  const mountGeneration = useRef({ generation: 0 });
  const client = useQueryClient();
  const questions = useInfiniteQuery({
    queryKey: ["live", courseId, session.id, "questions", filter, "floating"],
    queryFn: ({ pageParam }) =>
      getSessionQuestionsPage(courseId, session.id, filter, 50, pageParam),
    enabled: Boolean(external && !external.closed),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.offset + lastPage.items.length < lastPage.total
        ? lastPage.offset + lastPage.items.length
        : undefined,
    refetchInterval: 3000,
    refetchIntervalInBackground: true
  });
  const questionPages = questions.data?.pages ?? [];
  const questionItems = Array.from(
    new Map(questionPages.flatMap((page) => page.items).map((item) => [item.id, item])).values()
  );
  const feedback = useQuery({
    queryKey: ["live", courseId, session.id, "engagement"],
    queryFn: () => getStudentEngagement(courseId, session.id),
    enabled: Boolean(external && !external.closed),
    refetchInterval: 3000,
    refetchIntervalInBackground: true
  });
  const remoteRefresh = useRef(() => {});
  remoteRefresh.current = () => {
    void questions.refetch();
    void feedback.refetch();
  };
  useEffect(() => {
    if (!external || external.closed) return;
    // Use the visible window's timer. An inactive opener can have its own timers throttled.
    const refresh = () => {
      if (!external.closed && external.document.visibilityState !== "hidden")
        remoteRefresh.current();
    };
    const timer = external.setInterval(refresh, 1000);
    external.addEventListener("focus", refresh);
    external.document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => {
      external.clearInterval(timer);
      external.removeEventListener("focus", refresh);
      external.document.removeEventListener("visibilitychange", refresh);
    };
  }, [external]);
  const question = questionItems.find((item) => item.id === selected);
  const answer = question ? drafts[question.id] ?? question.answerText ?? "" : "";
  const update = useMutation({
    mutationFn: ({
      visibility,
      dismiss
    }: {
      visibility?: "AUTHOR" | "SESSION";
      dismiss?: boolean;
    }) => {
      if (!question || disabled) throw new Error("Вопрос недоступен");
      return updateStudentQuestion(
        courseId,
        session.id,
        question.id,
        dismiss
          ? { status: "DISMISSED" }
          : { status: "ANSWERED", answerVisibility: visibility, answerText: answer.trim() }
      );
    },
    onSuccess: () => {
      setSelected(null);
      setPublishing(false);
      void client.invalidateQueries({ queryKey: ["live", courseId, session.id] });
      toast.success("Вопрос обновлён.");
    },
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось отправить. Черновик сохранён."))
  });
  const finish = useMutation({
    mutationFn: () => endLiveSession(courseId, session.id),
    onSuccess: (ended) => {
      void controller.stop();
      closePublicProjection(session.joinCode);
      onSessionChange?.(ended);
      void client.invalidateQueries({ queryKey: ["active-session"] });
      onClose();
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось завершить занятие."))
  });
  useEffect(() => {
    if (initialWindow && !initialWindow.closed) setExternal(initialWindow);
  }, [initialWindow]);
  useEffect(() => {
    const lifecycle = mountGeneration.current;
    const generation = ++lifecycle.generation;
    return () => {
      // StrictMode immediately sets up again; only a real unmount closes the OS window.
      queueMicrotask(() => {
        if (lifecycle.generation === generation) externalRef.current?.close();
      });
    };
  }, []);
  useLayoutEffect(() => {
    if (!external || external.closed) return;
    externalRef.current = external;
    const stopThemeSync = prepareLectureRemoteWindow(external);
    const back = () => {
      externalRef.current = null;
      setExternal(null);
    };
    external.addEventListener("pagehide", back);
    return () => {
      stopThemeSync();
      external.removeEventListener("pagehide", back);
    };
  }, [external]);
  function changeCollapsed(next: boolean) {
    rememberLectureRemoteCollapsed(session.id, next);
    // Commit before resizing while the click's PiP user activation is still available.
    flushSync(() => setCollapsed(next));
    if (external) resizeLectureRemoteWindow(external, next);
  }
  const counts = questionPages[0]?.counts;
  const signals = feedback.data?.signalAggregate;
  if (!external || external.closed) return null;
  const content = (
    <aside
      className={`floating-lecture-remote is-detached${collapsed ? " is-collapsed" : ""}`}
      aria-label="Приватный пульт занятия"
    >
      <header className="floating-remote-header">
        <BrandMark className="brand-mark" />
        {!collapsed && <strong className="floating-remote-title">Пульт</strong>}
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Новые вопросы: ${counts?.open ?? 0}`}
            onClick={() => {
              setSection("questions");
              setFilter("OPEN");
              changeCollapsed(false);
            }}
          >
            <MessageCircle size={24} aria-hidden="true" />
            {(counts?.open ?? 0) > 0 && (
              <span className="floating-question-count">{counts?.open}</span>
            )}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label={collapsed ? "Развернуть пульт" : "Свернуть пульт"}
          onClick={() => changeCollapsed(!collapsed)}
        >
          {collapsed ? <PanelTopOpen size={20} /> : <PanelTopClose size={20} />}
        </Button>
        {!collapsed && (
          <Button variant="ghost" size="icon" aria-label="Закрыть пульт" onClick={onClose}>
            <X size={20} />
          </Button>
        )}
      </header>
      <div className="floating-remote-scroll" hidden={collapsed}>
        <div className="floating-remote-content">
          <div className="floating-remote-context">
            <span>
              {session.status === "PAUSED" ? "Пауза" : sharing ? "Демонстрация" : "Слайды"} ·{" "}
              {formatSessionTime(elapsed)}
            </span>
          </div>
          {sharing && (
            <div className="floating-remote-source">
              <span>{share.sourceName}</span>
            </div>
          )}
          <div className="floating-remote-signals" aria-label="Понимание">
            <div className="is-green">
              <strong>{signals?.green ?? "—"}</strong>
              <span>Понятно</span>
            </div>
            <div className="is-yellow">
              <strong>{signals?.yellow ?? "—"}</strong>
              <span>Есть вопрос</span>
            </div>
            <div className="is-red">
              <strong>{signals?.red ?? "—"}</strong>
              <span>Не понимаю</span>
            </div>
          </div>
          {(feedback.isError || questions.isError || disabled) && (
            <p className="floating-remote-error" role="alert">
              {disabled
                ? "Связь сверяется. Отправка временно недоступна."
                : "Не удалось обновить данные. Показаны последние значения."}
            </p>
          )}
          <LectureRemoteTools
            courseId={courseId}
            session={session}
            disabled={disabled}
            section={section}
            onSectionChange={setSection}
            onSessionChange={onSessionChange}
            container={external.document.body}
            noteDrafts={noteDrafts}
            onNoteDraftChange={changeNoteDraft}
            newQuestionCount={counts?.open ?? 0}
          >
            <div className="floating-remote-filters" role="group" aria-label="Вопросы">
              {(
                [
                  { status: "OPEN", label: "Новые", count: counts?.open },
                  { status: "ANSWERED", label: "Отвеченные", count: counts?.answered },
                  { status: "DISMISSED", label: "Скрытые", count: counts?.dismissed }
                ] as const
              ).map((item) => (
                <Button
                  variant={filter === item.status ? "secondary" : "ghost"}
                  key={item.status}
                  aria-pressed={filter === item.status}
                  onClick={() => {
                    setFilter(item.status);
                    setSelected(null);
                    setPublishing(false);
                  }}
                >
                  {item.label} ({item.count ?? 0})
                </Button>
              ))}
            </div>
            <div className="floating-remote-questions">
              {questions.isLoading && <p role="status">Загружаем вопросы…</p>}
              {!questions.isLoading && !questions.isError && questionItems.length === 0 && (
                <p className="muted">Здесь пока нет вопросов.</p>
              )}
              {questionItems.map((item) => (
                <article
                  className={`floating-remote-question${selected === item.id ? " is-selected" : ""}`}
                  key={item.id}
                >
                  <small>
                    {item.anonymous ? "Анонимный вопрос" : item.displayName || "Вопрос студента"} ·{" "}
                    {new Date(item.createdAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </small>
                  <button
                    className="floating-remote-question-title"
                    aria-expanded={selected === item.id}
                    onClick={() => {
                      setSelected(selected === item.id ? null : item.id);
                      setPublishing(false);
                    }}
                  >
                    {item.text}
                  </button>
                  {selected === item.id &&
                    (item.status === "OPEN" ? (
                      <div className="floating-remote-composer">
                        <label>
                          Ваш ответ
                          <textarea
                            rows={3}
                            maxLength={4000}
                            value={answer}
                            onChange={(event) =>
                              setDrafts((value) => ({ ...value, [item.id]: event.target.value }))
                            }
                          />
                        </label>
                        {publishing ? (
                          <div
                            className="floating-remote-publish"
                            role="group"
                            aria-label="Подтверждение публикации"
                          >
                            <strong>Опубликовать для участников?</strong>
                            <p>Вопрос и ответ будут видны всем без имени автора.</p>
                            <p>{answer}</p>
                            <div>
                              <Button variant="outline" onClick={() => setPublishing(false)}>
                                К ответу
                              </Button>
                              <Button
                                disabled={disabled || update.isPending || !answer.trim()}
                                onClick={() => update.mutate({ visibility: "SESSION" })}
                              >
                                Опубликовать
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <Button
                              disabled={disabled || update.isPending || !answer.trim()}
                              onClick={() => update.mutate({ visibility: "AUTHOR" })}
                            >
                              <LockKeyhole size={18} />
                              Ответить автору
                            </Button>
                            <Button
                              variant="outline"
                              disabled={disabled || update.isPending || !answer.trim()}
                              onClick={() => setPublishing(true)}
                            >
                              <Globe2 size={18} />
                              Опубликовать…
                            </Button>
                            <small>Без имени автора</small>
                            <Button
                              variant="ghost"
                              disabled={disabled || update.isPending}
                              onClick={() => update.mutate({ dismiss: true })}
                            >
                              Скрыть вопрос
                            </Button>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="floating-remote-record">
                        <p>{item.answerText || "Вопрос скрыт"}</p>
                        <small>
                          {item.answerVisibility === "AUTHOR"
                            ? "Личный ответ"
                            : item.answerVisibility === "SESSION"
                              ? "Опубликован без имени автора"
                              : ""}
                        </small>
                      </div>
                    ))}
                </article>
              ))}
            </div>
            {questions.isError && (
              <Button
                variant="outline"
                onClick={() =>
                  void (questions.hasNextPage && questionItems.length > 0
                    ? questions.fetchNextPage()
                    : questions.refetch())
                }
                disabled={questions.isFetching}
              >
                {questions.isFetching ? "Загружаем…" : "Повторить загрузку вопросов"}
              </Button>
            )}
            {questions.hasNextPage && !questions.isError && (
              <Button
                variant="outline"
                disabled={questions.isFetchingNextPage}
                onClick={() => void questions.fetchNextPage()}
              >
                {questions.isFetchingNextPage ? "Загружаем…" : "Показать ещё вопросы"}
              </Button>
            )}
          </LectureRemoteTools>
        </div>
      </div>
      <footer className="floating-remote-footer" hidden={collapsed}>
        <div className="floating-remote-actions">
          <Button
            variant="outline"
            disabled={disabled || session.status !== "LIVE" || !onChooseSource}
            onClick={() => {
              window.focus();
              onChooseSource?.();
            }}
          >
            <MonitorUp size={18} />
            {sharing ? "Сменить источник" : "Демонстрация"}
          </Button>
          <Button variant="outline" disabled={!sharing} onClick={() => void controller.stop()}>
            <Presentation size={18} />
            Вернуться к презентации
          </Button>
        </div>
        <div className="floating-remote-actions">
          <Button
            variant="outline"
            disabled={disabled}
            onClick={session.status === "PAUSED" ? onResume : onPause}
          >
            {session.status === "PAUSED" ? <Play size={18} /> : <Pause size={18} />}
            {session.status === "PAUSED" ? "Продолжить" : "Пауза"}
          </Button>
          <ConfirmActionButton
            container={external.document.body}
            title="Завершить занятие?"
            description="Показ у студентов и на проекторе закончится. Итоги занятия сохранятся."
            confirmLabel="Завершить"
            variant="outline"
            disabled={disabled || finish.isPending}
            onConfirm={() => finish.mutate()}
          >
            <Square size={18} />
            Завершить занятие
          </ConfirmActionButton>
        </div>
      </footer>
    </aside>
  );
  return createPortal(
    <>
      {content}
      <Toaster position="bottom-center" />
    </>,
    external.document.body
  );
}
