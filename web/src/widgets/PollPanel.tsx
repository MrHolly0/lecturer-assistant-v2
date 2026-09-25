import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  History,
  Plus
} from "lucide-react";
import { toast } from "sonner";
import {
  closePoll,
  getActivePoll,
  listClosedPolls,
  startPoll,
  startPollFromBank,
  type PollResult
} from "../app/api/interaction-api";
import { userErrorMessage } from "../app/api/errors";
import { pluralizeRu } from "../shared/lib/plural";
import { PollComposer, type PollDraft } from "./PollComposer";
import { Button } from "../shared/ui/button";
import { PollOptionText } from "./PollOptionText";

interface Props {
  courseId: string;
  sessionId: string;
  disabled?: boolean;
}

type View = "idle" | "create";

export function PollPanel({ courseId, sessionId, disabled = false }: Props) {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("idle");
  const [markedCorrect, setMarkedCorrect] = useState<number | undefined>(undefined);

  const activeQuery = useQuery({
    queryKey: ["poll", courseId, sessionId, "active"],
    queryFn: () => getActivePoll(courseId, sessionId),
    refetchInterval: (query) => (query.state.data?.poll.status === "OPEN" ? 1500 : false)
  });
  const activePoll = activeQuery.data;

  const startMut = useMutation({
    mutationFn: (draft: PollDraft) =>
      draft.questionId
        ? startPollFromBank(courseId, sessionId, { questionId: draft.questionId })
        : startPoll(courseId, sessionId, {
            questionText: draft.questionText,
            options: draft.options
          }),
    onSuccess: (result, draft) => {
      qc.setQueryData(["poll", courseId, sessionId, "active"], result);
      setView("idle");
      setMarkedCorrect(result.poll.correctOptionIdx ?? draft.correctOptionIdx);
      toast.success("Опрос запущен.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось запустить опрос."))
  });

  const closeMut = useMutation({
    mutationFn: (pollId: string) => closePoll(courseId, sessionId, pollId, markedCorrect),
    onSuccess: (result) => {
      qc.setQueryData(["poll", courseId, sessionId, "active"], result);
      void qc.invalidateQueries({ queryKey: ["poll", courseId, sessionId, "closed"] });
      toast.success("Опрос закрыт.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось закрыть опрос."))
  });

  useEffect(() => {
    if (activePoll?.poll.status === "CLOSED") setMarkedCorrect(undefined);
  }, [activePoll?.poll.id, activePoll?.poll.status]);

  useEffect(() => {
    if (disabled) setView("idle");
  }, [disabled]);

  if (activeQuery.isError) {
    return (
      <>
        <div className="poll-panel poll-panel-error" role="alert">
          <p>{userErrorMessage(activeQuery.error, "Не удалось проверить состояние опроса.")}</p>
          <Button type="button" variant="outline" onClick={() => activeQuery.refetch()}>
            Повторить
          </Button>
        </div>
        <ClosedPollHistory courseId={courseId} sessionId={sessionId} />
      </>
    );
  }

  if (view === "create") {
    return (
      <>
        <PollComposer
          courseId={courseId}
          pending={startMut.isPending}
          onCancel={() => setView("idle")}
          onStart={(draft) => startMut.mutate(draft)}
        />
        <ClosedPollHistory courseId={courseId} sessionId={sessionId} />
      </>
    );
  }

  if (activePoll) {
    const total = activePoll.totalResponses;
    return (
      <>
        <div className="poll-panel">
          <div className="poll-panel-header">
            <BarChart2 size={14} />
            <span className="poll-panel-title">{activePoll.poll.questionText}</span>
            <span className="poll-response-count">
              {total} {pluralizeRu(total, "ответ", "ответа", "ответов")}
            </span>
          </div>
          <div className="poll-bars">
            {activePoll.poll.options.map((opt, idx) => {
              const count = activePoll.votes[idx] ?? 0;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              const isClosed = activePoll.poll.status === "CLOSED";
              const isCorrect = isClosed
                ? activePoll.poll.correctOptionIdx === idx
                : markedCorrect === idx;
              return (
                <div
                  key={idx}
                  className={`poll-bar-row${isCorrect ? " poll-bar-row--correct" : ""}`}
                >
                  <button
                    type="button"
                    className="poll-bar-correct-toggle"
                    aria-label={`Отметить вариант ${idx + 1} правильным`}
                    aria-pressed={isCorrect}
                    disabled={isClosed}
                    onClick={() => setMarkedCorrect(isCorrect ? undefined : idx)}
                  >
                    {isCorrect ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  </button>
                  <PollOptionText text={opt} className="poll-bar-label" />
                  <div className="poll-bar-track">
                    <div className="poll-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="poll-bar-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
          {activePoll.poll.status === "OPEN" && (
            <>
              <p className="poll-correct-hint">
                {markedCorrect === undefined
                  ? "Выберите правильный вариант перед закрытием."
                  : "Выбранный правильный ответ станет виден студентам после закрытия."}
              </p>
              <Button
                type="button"
                disabled={closeMut.isPending || markedCorrect === undefined}
                onClick={() => closeMut.mutate(activePoll.poll.id)}
              >
                Закрыть и показать результат
              </Button>
            </>
          )}
          {activePoll.poll.status === "CLOSED" && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => setView("create")}
            >
              <Plus size={14} />
              Новая проверка
            </Button>
          )}
        </div>
        <ClosedPollHistory
          courseId={courseId}
          sessionId={sessionId}
          excludePollId={activePoll.poll.status === "CLOSED" ? activePoll.poll.id : undefined}
        />
      </>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="poll-launch-btn"
        disabled={disabled}
        onClick={() => setView("create")}
      >
        <BarChart2 size={14} />
        {disabled ? "Продолжите лекцию для проверки" : "Запустить проверку"}
      </Button>
      <ClosedPollHistory courseId={courseId} sessionId={sessionId} />
    </>
  );
}

function ClosedPollHistory({
  courseId,
  sessionId,
  excludePollId
}: Props & { excludePollId?: string }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const historyQuery = useInfiniteQuery({
    queryKey: ["poll", courseId, sessionId, "closed"],
    queryFn: ({ pageParam }) => listClosedPolls(courseId, sessionId, 10, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.items.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    }
  });
  const pages = historyQuery.data?.pages ?? [];
  const items = pages
    .flatMap((page) => page.items)
    .filter((result) => result.poll.id !== excludePollId);
  const total = Math.max(0, (pages[0]?.total ?? 0) - (excludePollId ? 1 : 0));

  if (!historyQuery.isLoading && !historyQuery.isError && total === 0) return null;

  return (
    <section className="poll-history" aria-label="История закрытых проверок">
      <Button
        type="button"
        variant="ghost"
        className="poll-history__toggle"
        aria-expanded={open}
        onClick={() => {
          if (!open) void historyQuery.refetch();
          setOpen((value) => !value);
        }}
      >
        <History size={15} aria-hidden="true" />
        Прошлые проверки
        {total > 0 && <span className="badge">{total}</span>}
        {open ? (
          <ChevronUp size={15} aria-hidden="true" />
        ) : (
          <ChevronDown size={15} aria-hidden="true" />
        )}
      </Button>
      {open && (
        <div className="poll-history__content">
          {historyQuery.isLoading && <p className="muted">Загрузка истории…</p>}
          {historyQuery.isError && (
            <div className="poll-history__error" role="alert">
              <span>Не удалось загрузить прошлые проверки.</span>
              <Button type="button" variant="outline" onClick={() => historyQuery.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {items.map((result) => (
            <ClosedPollResult
              key={result.poll.id}
              result={result}
              expanded={expandedId === result.poll.id}
              onToggle={() =>
                setExpandedId((current) => (current === result.poll.id ? null : result.poll.id))
              }
            />
          ))}
          {historyQuery.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              className="poll-history__more"
              disabled={historyQuery.isFetchingNextPage}
              onClick={() => historyQuery.fetchNextPage()}
            >
              {historyQuery.isFetchingNextPage ? "Загрузка…" : "Показать ещё"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function ClosedPollResult({
  result,
  expanded,
  onToggle
}: {
  result: PollResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="poll-history__item">
      <button
        type="button"
        className="poll-history__item-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span>{result.poll.questionText}</span>
        <small>
          {result.totalResponses} {pluralizeRu(result.totalResponses, "ответ", "ответа", "ответов")}
        </small>
      </button>
      {expanded && (
        <div className="poll-history__result">
          {result.poll.options.map((option, index) => {
            const count = result.votes[index] ?? 0;
            const percent =
              result.totalResponses > 0 ? Math.round((count / result.totalResponses) * 100) : 0;
            const correct = result.poll.correctOptionIdx === index;
            return (
              <div
                key={index}
                className={`poll-history__row${correct ? " poll-history__row--correct" : ""}`}
              >
                <PollOptionText text={option} />
                <div className="poll-history__track">
                  <i style={{ width: `${percent}%` }} />
                </div>
                <strong>{percent}%</strong>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
