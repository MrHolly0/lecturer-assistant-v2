import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GripVertical,
  MessageCircle,
  Maximize2,
  Minimize2,
  X,
  Pause,
  Play,
  Square,
  ExternalLink,
  LockKeyhole,
  Globe2
} from "lucide-react";
import { toast } from "sonner";
import {
  getSessionQuestionsPage,
  getStudentEngagement,
  updateStudentQuestion,
  type StudentQuestion
} from "../app/api/student-api";
import type { LiveSession } from "../app/api/live-api";
import { userErrorMessage } from "../app/api/errors";
import { BrandMark } from "../shared/brand/BrandMark";
import { Button } from "../shared/ui/button";
import { screenShare } from "../app/sharing/screenShare";
import { browserProjection } from "../app/projection/browserProjection";

type PictureInPictureHost = Window & {
  documentPictureInPicture?: {
    requestWindow: (options: { width: number; height: number }) => Promise<Window>;
  };
};
export function FloatingLectureRemote({
  courseId,
  session,
  disabled,
  onPause,
  onResume,
  onClose
}: {
  courseId: string;
  session: LiveSession;
  disabled: boolean;
  onPause: () => void;
  onResume: () => void;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [external, setExternal] = useState<Window | null>(null);
  const [filter, setFilter] = useState<StudentQuestion["status"]>("OPEN");
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const [position, setPosition] = useState({ x: Math.max(12, window.innerWidth - 444), y: 100 });
  const canPin =
    typeof (window as PictureInPictureHost).documentPictureInPicture?.requestWindow === "function";
  const panel = useRef<HTMLElement>(null);
  const externalRef = useRef<Window | null>(null);
  const client = useQueryClient();
  const questions = useInfiniteQuery({
    queryKey: ["live", courseId, session.id, "questions", filter, "floating"],
    queryFn: ({ pageParam }) =>
      getSessionQuestionsPage(courseId, session.id, filter, 50, pageParam),
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
    refetchInterval: 3000,
    refetchIntervalInBackground: true
  });
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
  useEffect(() => {
    if (external) return;
    const fit = () =>
      setPosition((value) => ({
        x: Math.max(
          8,
          Math.min(value.x, window.innerWidth - (panel.current?.offsetWidth ?? 240) - 8)
        ),
        y: Math.max(
          8,
          Math.min(value.y, window.innerHeight - (panel.current?.offsetHeight ?? 60) - 8)
        )
      }));
    const observer = new ResizeObserver(fit);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [collapsed, external]);
  useEffect(() => {
    return () => {
      externalRef.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!external) return;
    externalRef.current = external;
    external.document.title = "Lecturer Assistant · Пульт";
    const base = external.document.createElement("base");
    base.href = window.location.href;
    external.document.head.append(base);
    for (const source of document.querySelectorAll('link[rel="stylesheet"], style'))
      external.document.head.append(source.cloneNode(true));
    external.document.documentElement.className = document.documentElement.className;
    external.document.body.className = "floating-remote-document";
    const observer = new MutationObserver(() => {
      external.document.documentElement.className = document.documentElement.className;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const back = () => {
      externalRef.current = null;
      setExternal(null);
    };
    const closeBeforeMirror = () => {
      external.close();
    };
    external.addEventListener("pagehide", back);
    const unsubscribe = browserProjection.subscribe(() => {
      if (browserProjection.getSnapshot().phase === "stopped") closeBeforeMirror();
    });
    return () => {
      observer.disconnect();
      external.removeEventListener("pagehide", back);
      unsubscribe();
    };
  }, [external]);
  async function detach() {
    if (external && !external.closed) {
      external.focus();
      return;
    }
    try {
      const host = window as PictureInPictureHost;
      const child = canPin
        ? await host.documentPictureInPicture!.requestWindow({
            width: collapsed ? 280 : 420,
            height: collapsed ? 110 : 820
          })
        : window.open("", "lecturer-private-remote", "popup,width=420,height=820");
      if (!child) throw new Error("Разрешите всплывающие окна для сайта.");
      setExternal(child);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось открыть отдельный пульт.");
    }
  }
  function changeCollapsed(next: boolean) {
    setCollapsed(next);
    if (external) {
      try {
        external.resizeTo(
          (next ? 264 : 420) + Math.max(0, external.outerWidth - external.innerWidth),
          (next ? 72 : 820) + Math.max(0, external.outerHeight - external.innerHeight)
        );
      } catch {
        /* The browser owns PiP geometry; the content still remains scrollable. */
      }
    }
  }
  function drag(event: PointerEvent<HTMLButtonElement>) {
    if (external) return;
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) =>
      setPosition({
        x: Math.max(
          8,
          Math.min(
            origin.left + next.clientX - origin.x,
            window.innerWidth - (panel.current?.offsetWidth ?? 240) - 8
          )
        ),
        y: Math.max(
          8,
          Math.min(
            origin.top + next.clientY - origin.y,
            window.innerHeight - (panel.current?.offsetHeight ?? 60) - 8
          )
        )
      });
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end, { once: true });
    handle.addEventListener("pointercancel", end, { once: true });
  }
  const counts = questionPages[0]?.counts;
  const signals = feedback.data?.signalAggregate;
  const content = (
    <aside
      ref={panel}
      className={`floating-lecture-remote${collapsed ? " is-collapsed" : ""}${external ? " is-detached" : ""}`}
      style={external ? undefined : { left: position.x, top: position.y }}
      aria-label="Приватный пульт занятия"
    >
      <header className="floating-remote-header">
        <Button
          size="icon"
          variant="ghost"
          onPointerDown={drag}
          aria-label="Переместить пульт"
          onKeyDown={(event) => {
            if (!external && event.key.startsWith("Arrow")) {
              event.preventDefault();
              event.stopPropagation();
              setPosition((value) => ({
                x: Math.max(
                  8,
                  Math.min(
                    window.innerWidth - (panel.current?.offsetWidth ?? 260) - 8,
                    value.x +
                      (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0)
                  )
                ),
                y: Math.max(
                  8,
                  Math.min(
                    window.innerHeight - (panel.current?.offsetHeight ?? 60) - 8,
                    value.y + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0)
                  )
                )
              }));
            }
          }}
        >
          <GripVertical size={18} aria-hidden="true" />
        </Button>
        <BrandMark className="brand-mark" />
        {!collapsed && <strong>Пульт</strong>}
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Новые вопросы: ${counts?.open ?? 0}`}
            onClick={() => changeCollapsed(false)}
          >
            <MessageCircle size={24} aria-hidden="true" />
            <span className="floating-question-count">{counts?.open ?? 0}</span>
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label={collapsed ? "Развернуть пульт" : "Свернуть пульт"}
          onClick={() => changeCollapsed(!collapsed)}
        >
          {collapsed ? <Maximize2 size={20} /> : <Minimize2 size={20} />}
        </Button>
        {!collapsed && (
          <Button variant="ghost" size="icon" aria-label="Закрыть пульт" onClick={onClose}>
            <X size={20} />
          </Button>
        )}
      </header>
      <div className="floating-remote-content" hidden={collapsed}>
        <div className="floating-remote-context">
          <span>{session.status === "PAUSED" ? "Пауза" : "Демонстрация"}</span>
          <Button
            variant="link"
            onClick={() => {
              const channelId = screenShare.getSnapshot().localChannelId;
              const url = `${window.location.origin}${window.location.pathname}#/projection/${encodeURIComponent(session.joinCode)}${channelId ? `?shareAttempt=${encodeURIComponent(channelId)}` : ""}`;
              window.open(url, "lecturer-public-preview", "popup,width=960,height=600");
            }}
          >
            Что видит аудитория <ExternalLink size={14} />
          </Button>
        </div>
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
      </div>
      <footer className="floating-remote-footer" hidden={collapsed}>
        <div className="floating-remote-actions">
          <Button
            variant="outline"
            disabled={disabled}
            onClick={session.status === "PAUSED" ? onResume : onPause}
          >
            {session.status === "PAUSED" ? <Play size={18} /> : <Pause size={18} />}{" "}
            {session.status === "PAUSED" ? "Продолжить" : "Пауза"}
          </Button>
          <Button variant="destructive" onClick={() => void screenShare.stop()}>
            <Square size={18} />
            Остановить показ
          </Button>
        </div>
        {!external && (
          <>
            <Button
              className="floating-remote-detach"
              variant="ghost"
              onClick={() => void detach()}
            >
              <ExternalLink size={16} />
              {canPin ? "Поверх других приложений" : "Открыть отдельный пульт"}
            </Button>
            {!canPin && (
              <p className="floating-remote-hint">
                Для пульта поверх окон используйте Chrome или Edge.
              </p>
            )}
          </>
        )}
      </footer>
    </aside>
  );
  return external && !external.closed ? createPortal(content, external.document.body) : content;
}
