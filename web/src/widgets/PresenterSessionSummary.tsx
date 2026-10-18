import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { userErrorMessage } from "../app/api/errors";
import { getLectureSummary, type LectureSummary, type LiveSession } from "../app/api/live-api";
import { getDeck, slideImageUrl } from "../app/api/content-api";
import {
  getSessionQuestionsPage,
  type StudentQuestion,
  type StudentQuestionStatus
} from "../app/api/student-api";
import { pollAnalytics, signalShare } from "../shared/lib/sessionAnalytics";
import { pluralizeRu } from "../shared/lib/plural";
import { Button, LinkButton } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { SessionGroups } from "./SessionGroups";
import { PollOptionText } from "./PollOptionText";

interface PresenterSessionSummaryProps {
  courseId: string;
  session: LiveSession;
  backTo?: string;
  backLabel?: string;
}

export function PresenterSessionSummary({
  courseId,
  session,
  backTo = `/courses/${courseId}/materials`,
  backLabel = "К материалам"
}: PresenterSessionSummaryProps) {
  const summaryQuery = useQuery({
    queryKey: ["live", courseId, session.id, "summary"],
    queryFn: () => getLectureSummary(courseId, session.id)
  });
  const summary = summaryQuery.data;

  return (
    <main id="main-content" className="page session-analytics" tabIndex={-1}>
      <LinkButton to={backTo} variant="ghost" className="session-analytics__back">
        <ArrowLeft size={17} aria-hidden="true" />
        {backLabel}
      </LinkButton>

      {summaryQuery.isLoading && <p className="muted">Собираем итог занятия…</p>}
      {summaryQuery.isError && (
        <section className="session-analytics__error" role="alert">
          <p>{userErrorMessage(summaryQuery.error, "Не удалось загрузить итог занятия.")}</p>
          <Button type="button" variant="outline" onClick={() => void summaryQuery.refetch()}>
            Повторить
          </Button>
        </section>
      )}

      {summary && (
        <>
          <header className="session-analytics__header">
            <p className="session-analytics__eyebrow">Итог занятия</p>
            <h1>{summary.lectureTitle || session.lectureTitle}</h1>
            <p className="session-analytics__date">
              {formatDateTime(summary.startedAt)}
              {summary.endedAt ? ` · завершено ${formatClock(summary.endedAt)}` : ""}
            </p>
            <div className="session-analytics__groups">
              <SessionGroups groups={summary.groups} />
              {summary.groups.length === 0 && (
                <span className="muted">Занятие проводилось без учебных групп</span>
              )}
            </div>
            <dl className="session-analytics__facts">
              <Fact label="Длительность" value={formatDuration(summary.durationSeconds)} />
              <Fact label="В эфире" value={formatDuration(summary.activeDurationSeconds)} />
              <Fact label="На паузе" value={formatDuration(summary.pausedDurationSeconds)} />
              <Fact label="Подключения" value={String(summary.participantCount)} />
            </dl>
          </header>

          <Attention summary={summary} />
          <section
            className="session-analytics__section session-analytics__overview"
            aria-labelledby="analytics-overview-title"
          >
            <div className="session-analytics__section-heading">
              <div>
                <p className="session-analytics__eyebrow">Сохранённые сигналы</p>
                <h2 id="analytics-overview-title">Как шло занятие</h2>
              </div>
              <p className="muted">
                Учитывается последний сигнал каждого участника на каждом слайде.
              </p>
            </div>
            <SignalDistribution totals={summary.signalTotals} />
            <OverallPollAccuracy polls={summary.pollResults} />
          </section>

          <ProblemSlides summary={summary} courseId={courseId} deckId={session.deckId} />
          <PollResults summary={summary} />
          <QuestionHistory
            courseId={courseId}
            sessionId={session.id}
            fallbackQuestions={summary.unansweredQuestions}
            fallbackOpenCount={summary.unansweredQuestionCount}
          />
          <GroupBreakdown summary={summary} />
        </>
      )}
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="session-analytics__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Attention({ summary }: { summary: LectureSummary }) {
  const pollsWithWrongAnswers = summary.pollResults.filter((poll) => {
    const result = pollAnalytics([poll]);
    return result.gradedAnswers > result.correctAnswers;
  });
  const hasOpenQuestions = summary.unansweredQuestionCount > 0;
  const hasSignals = summary.signalTotals.total > 0;
  const attentionCount =
    (summary.problemSlides.length > 0 ? 1 : 0) +
    (pollsWithWrongAnswers.length > 0 ? 1 : 0) +
    (hasOpenQuestions ? 1 : 0);
  return (
    <section
      id="attention"
      className={`session-analytics__attention${attentionCount ? " has-items" : ""}`}
      aria-labelledby="attention-title"
    >
      <div className="session-analytics__section-heading">
        <div>
          <p className="session-analytics__eyebrow">Коротко о важном</p>
          <h2 id="attention-title">Требует внимания</h2>
        </div>
        <span className="session-analytics__attention-count">
          {attentionCount
            ? `${attentionCount} ${pluralizeRu(attentionCount, "пункт", "пункта", "пунктов")}`
            : "Нет пунктов"}
        </span>
      </div>
      {attentionCount === 0 ? (
        <p className="session-analytics__empty">
          {hasSignals || summary.pollResults.length || summary.questionsCount
            ? "По сохранённым данным нет красных сигналов, неверных ответов или вопросов, ожидающих ответа."
            : "Для этого занятия пока нет данных о сигналах, проверках и вопросах."}
        </p>
      ) : (
        <ul className="session-analytics__attention-list">
          {summary.problemSlides.length > 0 && (
            <li>
              <AttentionLink
                targetId="difficult-slides-title"
                title="Слайды с затруднениями"
                count={summary.problemSlides.length}
                unit={["слайд", "слайда", "слайдов"]}
              />
            </li>
          )}
          {pollsWithWrongAnswers.length > 0 && (
            <li>
              <AttentionLink
                targetId="poll-results-title"
                title="Проверки с неверными ответами"
                count={pollsWithWrongAnswers.length}
                unit={["проверка", "проверки", "проверок"]}
              />
            </li>
          )}
          {hasOpenQuestions && (
            <li>
              <AttentionLink
                targetId="session-questions-title"
                title="Вопросы, ожидающие ответа"
                count={summary.unansweredQuestionCount}
                unit={["вопрос", "вопроса", "вопросов"]}
              />
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function AttentionLink({
  targetId,
  title,
  count,
  unit
}: {
  targetId: string;
  title: string;
  count: number;
  unit: [string, string, string];
}) {
  return (
    <button type="button" onClick={() => focusAnalyticsHeading(targetId)}>
      <span>{title}</span>
      <strong>
        {count} {pluralizeRu(count, ...unit)}
      </strong>
    </button>
  );
}

function focusAnalyticsHeading(id: string) {
  const heading = document.getElementById(id);
  if (!(heading instanceof HTMLElement)) return;
  heading.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    block: "start"
  });
  heading.focus({ preventScroll: true });
}

function SignalDistribution({ totals }: { totals: LectureSummary["signalTotals"] }) {
  const segments = [
    { key: "green", label: "Понятно", value: totals.green },
    { key: "yellow", label: "Есть вопрос", value: totals.yellow },
    { key: "red", label: "Не понимаю", value: totals.red }
  ] as const;
  return (
    <div className="session-analytics__signals">
      {totals.total > 0 ? (
        <div
          className="session-analytics__signal-bar"
          role="img"
          aria-label={segments.map(({ label, value }) => `${label}: ${value}`).join(", ")}
        >
          {segments.map(({ key, value }) => (
            <span
              key={key}
              className={`is-${key}`}
              style={{ width: `${(value / totals.total) * 100}%` }}
            />
          ))}
        </div>
      ) : (
        <p className="session-analytics__empty">Сохранённых сигналов нет.</p>
      )}
      <ul className="session-analytics__signal-legend">
        {segments.map(({ key, label, value }) => (
          <li key={key} className={`is-${key}`}>
            <span className="session-analytics__legend-dot" aria-hidden="true" />
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{formatPercent(signalShare(value, totals.total))}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OverallPollAccuracy({ polls }: { polls: LectureSummary["pollResults"] }) {
  const analytics = pollAnalytics(polls);
  return (
    <div className="session-analytics__accuracy">
      <div>
        <p className="session-analytics__eyebrow">Верные ответы в проверках</p>
        {analytics.gradedAnswers > 0 ? (
          <div className="session-analytics__accuracy-result">
            <strong className="session-analytics__accuracy-percent">
              {formatPercent(analytics.correctPercent)}
            </strong>
            <span>
              <strong>
                {analytics.correctAnswers} из {analytics.gradedAnswers}
              </strong>{" "}
              оценённых ответов
            </span>
          </div>
        ) : (
          <strong className="session-analytics__accuracy-empty">Нет оценённых ответов</strong>
        )}
        <p className="muted">
          {analytics.gradedAnswers > 0
            ? "Доля верных ответов среди ответов в закрытых проверках с отмеченным правильным вариантом."
            : "Правильность не рассчитана: нет закрытых проверок с отмеченным правильным вариантом и ответами."}
        </p>
        {analytics.gradedAnswers > 0 && (
          <>
            <div
              className="session-analytics__accuracy-bar"
              role="img"
              aria-label={`${analytics.correctAnswers} верных и ${analytics.incorrectAnswers} неверных ответов`}
            >
              <span
                className="is-correct"
                style={{ width: `${(analytics.correctAnswers / analytics.gradedAnswers) * 100}%` }}
              />
              <span
                className="is-incorrect"
                style={{
                  width: `${(analytics.incorrectAnswers / analytics.gradedAnswers) * 100}%`
                }}
              />
            </div>
            <div className="session-analytics__accuracy-legend">
              <span>
                <i className="is-correct" />
                Верно: {analytics.correctAnswers}
              </span>
              <span>
                <i className="is-incorrect" />
                Неверно: {analytics.incorrectAnswers}
              </span>
            </div>
          </>
        )}
        {analytics.ungradedAnswers > 0 && (
          <small className="muted">
            Ещё {analytics.ungradedAnswers} ответов не включены: проверка не закрыта или правильный
            вариант не отмечен.
          </small>
        )}
      </div>
      <div className="session-analytics__accuracy-counts" aria-label="Итог по ответам в проверках">
        <span>
          <strong>{analytics.totalAnswers}</strong> ответов всего
        </span>
        <span>
          <strong>{analytics.gradedPollCount}</strong> проверок с правильным вариантом
        </span>
      </div>
    </div>
  );
}

function ProblemSlides({
  summary,
  courseId,
  deckId
}: {
  summary: LectureSummary;
  courseId: string;
  deckId: string;
}) {
  const [previewSlideIdx, setPreviewSlideIdx] = useState<number | null>(null);
  const [previewImageState, setPreviewImageState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [previewImageAttempt, setPreviewImageAttempt] = useState(0);
  const previewOpenerRef = useRef<HTMLButtonElement | null>(null);
  const deckQuery = useQuery({
    queryKey: ["courses", courseId, "decks", deckId, "summary-preview"],
    queryFn: () => getDeck(courseId, deckId),
    enabled: previewSlideIdx !== null
  });
  const previewSlide = deckQuery.data?.slides.find((slide) => slide.idx === previewSlideIdx);

  return (
    <section
      id="difficult-slides"
      className="session-analytics__section"
      aria-labelledby="difficult-slides-title"
    >
      <div className="session-analytics__section-heading">
        <div>
          <p className="session-analytics__eyebrow">Красные сигналы</p>
          <h2 id="difficult-slides-title" tabIndex={-1}>
            Слайды с затруднениями
          </h2>
        </div>
        <span className="muted">
          {summary.problemSlides.length}{" "}
          {pluralizeRu(summary.problemSlides.length, "слайд", "слайда", "слайдов")}
        </span>
      </div>
      {summary.problemSlides.length === 0 ? (
        <p className="session-analytics__empty">
          Сигналов «Не понимаю» на слайдах не зафиксировано.
        </p>
      ) : (
        <ol className="session-analytics__slide-list">
          {summary.problemSlides.map((slide) => (
            <li key={slide.slideIdx}>
              <strong className="session-analytics__slide-number">Слайд {slide.slideIdx}</strong>
              <div className="session-analytics__slide-signals">
                <SignalCount kind="red" label="Не понимаю" value={slide.red} />
                <SignalCount kind="yellow" label="Есть вопрос" value={slide.yellow} />
                <SignalCount kind="green" label="Понятно" value={slide.green} />
                <span className="session-analytics__slide-total">
                  {slide.total} {pluralizeRu(slide.total, "сигнал", "сигнала", "сигналов")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={(event) => {
                    previewOpenerRef.current = event.currentTarget;
                    setPreviewImageState("loading");
                    setPreviewImageAttempt(0);
                    setPreviewSlideIdx(slide.slideIdx);
                  }}
                >
                  Открыть слайд {slide.slideIdx}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Dialog
        open={previewSlideIdx !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPreviewSlideIdx(null);
          setPreviewImageState("idle");
        }}
      >
        <DialogContent
          className="session-analytics__slide-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = previewOpenerRef.current;
            if (opener?.isConnected) opener.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>Слайд {previewSlideIdx}</DialogTitle>
            <DialogDescription>
              Предпросмотр из сохранённой презентации. Состояние занятия не меняется.
            </DialogDescription>
          </DialogHeader>
          {deckQuery.isLoading && <p className="muted">Загружаем слайд…</p>}
          {deckQuery.isError && (
            <div className="session-analytics__preview-error" role="alert">
              <p>{userErrorMessage(deckQuery.error, "Не удалось загрузить слайд.")}</p>
              <Button type="button" variant="outline" onClick={() => void deckQuery.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {previewSlide && previewImageState === "loading" && (
            <p className="muted" role="status">
              Загружаем изображение слайда…
            </p>
          )}
          {previewSlide && previewImageState === "error" && (
            <div className="session-analytics__preview-error" role="alert">
              <p>Не удалось загрузить изображение слайда.</p>
              <Button
                type="button"
                variant="outline"
                disabled={deckQuery.isFetching}
                onClick={() => {
                  setPreviewImageState("loading");
                  void deckQuery.refetch().then(() => {
                    setPreviewImageAttempt((attempt) => attempt + 1);
                  });
                }}
              >
                {deckQuery.isFetching ? "Повторяем…" : "Повторить"}
              </Button>
            </div>
          )}
          {previewSlide && (
            <img
              key={previewImageAttempt}
              src={slideImageUrl(previewSlide)}
              alt={`Слайд ${previewSlide.idx}`}
              onLoad={() => setPreviewImageState("loaded")}
              onError={() => setPreviewImageState("error")}
              hidden={previewImageState !== "loaded"}
            />
          )}
          {!deckQuery.isLoading && !deckQuery.isError && deckQuery.data && !previewSlide && (
            <p className="muted">Этот слайд больше недоступен в презентации.</p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SignalCount({
  kind,
  label,
  value
}: {
  kind: "red" | "yellow" | "green";
  label: string;
  value: number;
}) {
  return (
    <span className={`session-analytics__slide-count is-${kind}`}>
      <i aria-hidden="true" />
      {label}: <strong>{value}</strong>
    </span>
  );
}

function PollResults({ summary }: { summary: LectureSummary }) {
  const result = pollAnalytics(summary.pollResults);
  return (
    <section className="session-analytics__section" aria-labelledby="poll-results-title">
      <div className="session-analytics__section-heading">
        <div>
          <p className="session-analytics__eyebrow">Ответы аудитории</p>
          <h2 id="poll-results-title" tabIndex={-1}>
            Проверки
          </h2>
        </div>
        <span className="muted">
          {summary.pollResults.length}{" "}
          {pluralizeRu(summary.pollResults.length, "проверка", "проверки", "проверок")}
        </span>
      </div>
      {summary.pollResults.length === 0 ? (
        <p className="session-analytics__empty">Во время занятия проверок не запускали.</p>
      ) : (
        <>
          <p className="session-analytics__poll-summary">
            Верно {result.correctAnswers} из {result.gradedAnswers} ответов с оценённой
            правильностью
            {result.correctPercent !== null ? ` · ${result.correctPercent}%` : ""}.
          </p>
          <div className="session-analytics__poll-list">
            {summary.pollResults.map((poll) => (
              <PollResult key={poll.pollId} poll={poll} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PollResult({ poll }: { poll: LectureSummary["pollResults"][number] }) {
  const analytics = pollAnalytics([poll]);
  const graded = analytics.gradedAnswers > 0;
  const validAnswer =
    poll.correctOptionIdx !== null &&
    poll.correctOptionIdx !== undefined &&
    Number.isInteger(poll.correctOptionIdx) &&
    poll.correctOptionIdx >= 0 &&
    poll.correctOptionIdx < poll.options.length;
  const gradedPoll = poll.status === "CLOSED" && validAnswer;
  return (
    <article id={`poll-${poll.pollId}`} className="session-analytics__poll">
      <div className="session-analytics__poll-heading">
        <h3>{poll.questionText}</h3>
        <span>
          {poll.totalResponses} {pluralizeRu(poll.totalResponses, "ответ", "ответа", "ответов")}
        </span>
      </div>
      {graded ? (
        <p className="session-analytics__poll-correct">
          Верно{" "}
          <strong>
            {analytics.correctAnswers} из {analytics.gradedAnswers}
          </strong>
          {analytics.correctPercent !== null ? ` · ${analytics.correctPercent}%` : ""}
        </p>
      ) : (
        <p className="muted">
          {poll.status !== "CLOSED"
            ? "Проверка не закрыта, правильность не рассчитана."
            : validAnswer
              ? "Нет ответов."
              : "Правильный вариант не отмечен, процент не рассчитан."}
        </p>
      )}
      {poll.totalResponses === 0 ? (
        <p className="session-analytics__empty">
          Ответов нет. Это не показывает, поняла ли аудитория материал.
        </p>
      ) : (
        <ul className="session-analytics__options">
          {poll.options.map((option, index) => {
            const count = Math.max(0, poll.votes[index] ?? 0);
            const percent = signalShare(count, poll.totalResponses);
            return (
              <li
                key={`${poll.pollId}-${index}`}
                className={gradedPoll && poll.correctOptionIdx === index ? "is-correct" : undefined}
              >
                <div className="session-analytics__option-label">
                  <PollOptionText text={option} />
                  {gradedPoll && poll.correctOptionIdx === index && <span>Правильный вариант</span>}
                </div>
                <div className="session-analytics__option-track" aria-hidden="true">
                  <i style={{ width: `${percent ?? 0}%` }} />
                </div>
                <strong>
                  {count} <small>· {formatPercent(percent)}</small>
                </strong>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function QuestionHistory({
  courseId,
  sessionId,
  fallbackQuestions,
  fallbackOpenCount
}: {
  courseId: string;
  sessionId: string;
  fallbackQuestions: StudentQuestion[];
  fallbackOpenCount: number;
}) {
  const [status, setStatus] = useState<StudentQuestionStatus>("OPEN");
  const query = useInfiniteQuery({
    queryKey: ["live", courseId, sessionId, "questions", status],
    queryFn: ({ pageParam }) => getSessionQuestionsPage(courseId, sessionId, status, 50, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.offset + lastPage.items.length < lastPage.total
        ? lastPage.offset + lastPage.items.length
        : undefined
  });
  const pages = query.data?.pages ?? [];
  const countCacheRef = useRef(
    new Map<string, { open: number; answered: number; dismissed: number }>()
  );
  const items = Array.from(
    new Map(pages.flatMap((page) => page.items).map((question) => [question.id, question])).values()
  );
  const scope = `${courseId}:${sessionId}`;
  const counts = pages[0]?.counts;
  if (counts) countCacheRef.current.set(scope, counts);
  const latestCounts = counts ?? countCacheRef.current.get(scope);
  const statusTabs: Array<{ key: StudentQuestionStatus; label: string; count?: number }> = [
    {
      key: "OPEN",
      label: "Ждут ответа",
      count: latestCounts?.open ?? (query.isError ? fallbackOpenCount : undefined)
    },
    { key: "ANSWERED", label: "Отвеченные", count: latestCounts?.answered },
    { key: "DISMISSED", label: "Скрытые", count: latestCounts?.dismissed }
  ];
  const fallbackOpen = query.isError && status === "OPEN" && items.length === 0;
  const fallbackList = fallbackOpen ? fallbackQuestions : [];
  return (
    <section
      id="session-questions"
      className="session-analytics__section"
      aria-labelledby="session-questions-title"
    >
      <div className="session-analytics__section-heading">
        <div>
          <p className="session-analytics__eyebrow">История вопросов</p>
          <h2 id="session-questions-title" tabIndex={-1}>
            Вопросы студентов
          </h2>
        </div>
      </div>
      <div className="session-analytics__question-tabs" role="group" aria-label="Статус вопросов">
        {statusTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={status === tab.key}
            onClick={() => setStatus(tab.key)}
          >
            {tab.label}
            {tab.count !== undefined && <span>{tab.count}</span>}
          </button>
        ))}
      </div>
      {query.isError && (
        <div className="session-analytics__question-error" role="alert">
          <span>
            Не удалось загрузить историю вопросов.{" "}
            {fallbackOpen
              ? "Показаны вопросы, сохранённые в итоговой сводке."
              : "Числа для остальных статусов недоступны."}
          </span>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            Повторить
          </Button>
        </div>
      )}
      {query.isLoading ? <p className="muted">Загружаем вопросы…</p> : null}
      {!query.isLoading && items.length === 0 && fallbackList.length === 0 && !query.isError && (
        <p className="session-analytics__empty">
          {status === "OPEN"
            ? "Вопросов, ожидающих ответа, нет."
            : status === "ANSWERED"
              ? "Сохранённых ответов нет."
              : "Скрытых вопросов нет."}
        </p>
      )}
      <ul className="session-analytics__question-list">
        {(fallbackOpen ? fallbackList : items).map((question) => (
          <QuestionItem key={question.id} question={question} />
        ))}
      </ul>
      {query.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
        </Button>
      )}
    </section>
  );
}

function QuestionItem({ question }: { question: StudentQuestion }) {
  const [expanded, setExpanded] = useState(false);
  const statusLabel =
    question.status === "OPEN"
      ? "Ждёт ответа"
      : question.status === "ANSWERED"
        ? "Отвечен"
        : "Скрыт";
  return (
    <li className="session-analytics__question">
      <button
        type="button"
        className="session-analytics__question-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown size={18} aria-hidden="true" />
        ) : (
          <ChevronRight size={18} aria-hidden="true" />
        )}
        <span className={`session-analytics__question-summary${expanded ? " is-expanded" : ""}`}>
          <span className="session-analytics__question-meta">
            {question.anonymous ? "Анонимный вопрос" : question.displayName || "Студент"} ·{" "}
            {formatDateTime(question.createdAt)}
          </span>
          <span>{question.text}</span>
        </span>
        <span className={`session-analytics__question-status is-${question.status.toLowerCase()}`}>
          {statusLabel}
        </span>
      </button>
      {expanded && (
        <div className="session-analytics__question-detail">
          {question.status === "ANSWERED" && question.answerText ? (
            <div>
              <strong>Ответ преподавателя</strong>
              <p>{question.answerText}</p>
              <small>
                {question.answerVisibility === "SESSION"
                  ? "Виден участникам занятия"
                  : question.answerVisibility === "AUTHOR"
                    ? "Виден автору"
                    : "Область ответа не указана"}
              </small>
            </div>
          ) : question.status === "ANSWERED" ? (
            <p>Ответ сохранён без текста в итоговой сводке.</p>
          ) : null}
          {question.status === "DISMISSED" && <p>Вопрос скрыт. Он не считается отвеченным.</p>}
          {question.status === "OPEN" && <p>Вопрос ожидает ответа.</p>}
        </div>
      )}
    </li>
  );
}

function GroupBreakdown({ summary }: { summary: LectureSummary }) {
  if (summary.groupBreakdowns.length === 0) {
    return (
      <section className="session-analytics__section" aria-labelledby="group-results-title">
        <div className="session-analytics__section-heading">
          <h2 id="group-results-title">Результаты по группам</h2>
        </div>
        <p className="session-analytics__empty">Занятие проводилось без учебных групп.</p>
      </section>
    );
  }
  return (
    <section className="session-analytics__section" aria-labelledby="group-results-title">
      <div className="session-analytics__section-heading">
        <div>
          <p className="session-analytics__eyebrow">Сравнение</p>
          <h2 id="group-results-title">Результаты по группам</h2>
        </div>
      </div>
      <p className="muted session-analytics__group-note">
        Группа привязана к подключению. Общие числа могут не совпадать с суммой групп: часть
        подключений могла быть без группы.
      </p>
      <div className="session-analytics__group-list">
        {summary.groupBreakdowns.map((group) => {
          const analytics = pollAnalytics(group.pollResults);
          return (
            <article className="session-analytics__group" key={group.group.id}>
              <h3>{group.group.name || "Без названия"}</h3>
              <p>
                {group.participantCount}{" "}
                {pluralizeRu(group.participantCount, "подключение", "подключения", "подключений")}
              </p>
              <dl>
                <div>
                  <dt>Красные сигналы</dt>
                  <dd>{group.signalTotals.red}</dd>
                </div>
                <div>
                  <dt>Верные ответы в проверках</dt>
                  <dd>
                    {analytics.correctPercent !== null
                      ? `${analytics.correctAnswers} из ${analytics.gradedAnswers} · ${analytics.correctPercent}%`
                      : "Нет оценённых ответов"}
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (safeSeconds === 0) return "0 мин";
  if (safeSeconds < 60) return "< 1 мин";
  return `${minutes} мин`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(date);
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatPercent(percent: number | null) {
  return percent === null ? "Нет данных" : `${percent}%`;
}
