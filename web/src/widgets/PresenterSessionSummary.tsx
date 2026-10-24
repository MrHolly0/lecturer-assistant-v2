import { TextPollResponses } from "./TextPollResponses";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CircleAlert,
  FileText,
  ListChecks,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  UserRound,
  UsersRound,
  Globe2
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { SearchField } from "./ListControls";
import {
  formatSessionDuration as formatDuration,
  formatSessionPeriod,
  summaryTab,
  type SummaryTab
} from "../shared/lib/analyticsNavigation";
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
  DialogTitle,
  DialogTrigger
} from "../shared/ui/dialog";
import { SessionGroups } from "./SessionGroups";
import { PollOptionText } from "./PollOptionText";
import { SummaryParticipants } from "./SummaryParticipants";

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
  const [params, setParams] = useSearchParams();
  const tab = summaryTab(params.get("summaryTab"));
  const pendingPanelFocus = useRef<SummaryTab | null>(null);
  useEffect(() => {
    if (pendingPanelFocus.current !== tab) return;
    pendingPanelFocus.current = null;
    document.querySelector<HTMLElement>('[data-slot="tabs-content"][data-state="active"]')?.focus();
  }, [tab]);
  function openTab(
    value: SummaryTab,
    selection?: { key: string; value: string },
    focusPanel = false
  ) {
    if (focusPanel) pendingPanelFocus.current = value;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summaryTab", value);
      if (selection) {
        next.set(selection.key, selection.value);
        if (selection.key === "summaryParticipantGroup") {
          next.delete("summaryParticipantSearch");
          next.delete("summaryParticipantPage");
        }
      }
      return next;
    });
  }
  const summaryQuery = useQuery({
    queryKey: ["live", courseId, session.id, "summary"],
    queryFn: () => getLectureSummary(courseId, session.id)
  });
  const summary = summaryQuery.data;
  useEffect(() => {
    if (!summary) return;
    document
      .querySelector<HTMLElement>('.report-tabs__list [data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [summary, tab]);

  return (
    <main
      id="main-content"
      className="page page--wide session-analytics report-workspace"
      tabIndex={-1}
    >
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
              {formatSessionPeriod(summary.startedAt, summary.endedAt)}
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

          <Tabs
            value={tab}
            onValueChange={(value) => openTab(value as SummaryTab)}
            className="report-tabs"
          >
            <TabsList aria-label="Разделы итога занятия" className="report-tabs__list">
              <TabsTrigger value="overview">
                <BarChart3 size={18} aria-hidden="true" />
                Сводка
              </TabsTrigger>
              <TabsTrigger value="participants">
                <UserRound size={18} aria-hidden="true" />
                Участники <span>{summary.participants.length}</span>
              </TabsTrigger>
              <TabsTrigger value="slides">
                <FileText size={18} aria-hidden="true" />
                Слайды
              </TabsTrigger>
              <TabsTrigger value="checks">
                <ListChecks size={18} aria-hidden="true" />
                Проверки <span>{summary.pollResults.length}</span>
              </TabsTrigger>
              <TabsTrigger value="questions">
                <MessageCircle size={18} aria-hidden="true" />
                Вопросы <span>{summary.questionsCount}</span>
              </TabsTrigger>
              <TabsTrigger value="groups">
                <UsersRound size={18} aria-hidden="true" />
                Группы <span>{summary.groups.length}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="report-panel">
              <Attention
                summary={summary}
                onOpen={(value, selection) => openTab(value, selection, true)}
              />
              <div className="report-overview">
                <section className="session-analytics__section">
                  <div className="session-analytics__section-heading">
                    <div>
                      <h2>Сохранённые сигналы</h2>
                      <p className="muted">Последний сигнал подключения на каждом слайде.</p>
                    </div>
                    <span className="muted">Всего: {summary.signalTotals.total}</span>
                  </div>
                  <SignalDistribution totals={summary.signalTotals} />
                </section>
                <section className="session-analytics__section">
                  <div className="session-analytics__section-heading">
                    <h2>Проверки</h2>
                    <span className="muted">{summary.pollResults.length}</span>
                  </div>
                  <OverallPollAccuracy polls={summary.pollResults} />
                  <Button variant="ghost" onClick={() => openTab("checks", undefined, true)}>
                    К проверкам <ArrowRight size={16} aria-hidden="true" />
                  </Button>
                </section>
              </div>
              <OverviewQuestions
                courseId={courseId}
                sessionId={session.id}
                summary={summary}
                onOpen={() => openTab("questions", undefined, true)}
              />
            </TabsContent>
            <TabsContent value="slides" className="report-panel">
              <ProblemSlides summary={summary} courseId={courseId} deckId={session.deckId} />
            </TabsContent>
            <TabsContent value="checks" className="report-panel">
              <PollResults summary={summary} courseId={courseId} />
            </TabsContent>
            <TabsContent value="questions" className="report-panel">
              <QuestionHistory
                courseId={courseId}
                sessionId={session.id}
                fallbackQuestions={summary.unansweredQuestions}
                fallbackOpenCount={summary.unansweredQuestionCount}
              />
            </TabsContent>
            <TabsContent value="groups" className="report-panel">
              <GroupBreakdown
                summary={summary}
                onOpenParticipants={(groupId = "all") =>
                  openTab("participants", { key: "summaryParticipantGroup", value: groupId }, true)
                }
              />
            </TabsContent>
            <TabsContent value="participants" className="report-panel">
              <SummaryParticipants summary={summary} />
            </TabsContent>
          </Tabs>
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

function Attention({
  summary,
  onOpen
}: {
  summary: LectureSummary;
  onOpen: (tab: SummaryTab, selection?: { key: string; value: string }) => void;
}) {
  const wrong = summary.pollResults.filter((poll) => {
    const result = pollAnalytics([poll]);
    return result.incorrectAnswers > 0;
  });
  const rows: Array<{
    title: string;
    detail: string;
    tab: SummaryTab;
    selection?: { key: string; value: string };
  }> = [];
  if (summary.problemSlides.length)
    rows.push({
      title:
        summary.problemSlides.length === 1
          ? `Слайд ${summary.problemSlides[0].slideIdx}`
          : "Слайды с затруднениями",
      detail: `${summary.problemSlides.length} ${pluralizeRu(summary.problemSlides.length, "слайд", "слайда", "слайдов")} с сигналами «Не понимаю»`,
      tab: "slides",
      selection: { key: "summarySlide", value: String(summary.problemSlides[0].slideIdx) }
    });
  if (wrong.length)
    rows.push({
      title:
        wrong.length === 1
          ? `Проверка ${summary.pollResults.indexOf(wrong[0]) + 1}`
          : "Проверки с неверными ответами",
      detail: `${wrong.length} ${pluralizeRu(wrong.length, "проверка", "проверки", "проверок")} с неверными ответами`,
      tab: "checks",
      selection: { key: "summaryPoll", value: wrong[0].pollId }
    });
  if (summary.unansweredQuestionCount)
    rows.push({
      title: "Вопросы без ответа",
      detail: `${summary.unansweredQuestionCount} ${pluralizeRu(summary.unansweredQuestionCount, "вопрос ждёт", "вопроса ждут", "вопросов ждут")} ответа`,
      tab: "questions",
      selection: { key: "summaryQuestionStatus", value: "OPEN" }
    });
  return (
    <section className="session-analytics__attention" aria-labelledby="attention-title">
      <div className="session-analytics__section-heading">
        <h2 id="attention-title">Требует внимания</h2>
        <span className="muted">
          {rows.length
            ? `${rows.length} ${pluralizeRu(rows.length, "пункт", "пункта", "пунктов")}`
            : "Нет пунктов"}
        </span>
      </div>
      {rows.length ? (
        <ul className="report-attention">
          {rows.map((row) => (
            <li key={row.tab}>
              <button type="button" onClick={() => onOpen(row.tab, row.selection)}>
                <CircleAlert size={22} aria-hidden="true" />
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                </span>
                <span className="report-attention__action">
                  Посмотреть <ArrowRight size={16} aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="session-analytics__empty">
          {summary.signalTotals.total || summary.pollResults.length || summary.questionsCount
            ? "По сохранённым данным нет красных сигналов, неверных ответов или вопросов, ожидающих ответа."
            : "Для занятия ещё нет данных о сигналах, проверках и вопросах."}
        </p>
      )}
    </section>
  );
}

function OverviewQuestions({
  courseId,
  sessionId,
  summary,
  onOpen
}: {
  courseId: string;
  sessionId: string;
  summary: LectureSummary;
  onOpen: () => void;
}) {
  const query = useQuery({
    queryKey: ["live", courseId, sessionId, "question-counts"],
    queryFn: () => getSessionQuestionsPage(courseId, sessionId, "OPEN", 1, 0)
  });
  const counts = query.data?.counts;
  return (
    <section className="session-analytics__section report-question-overview">
      <div className="session-analytics__section-heading">
        <h2>Вопросы</h2>
        <span className="muted">Всего: {summary.questionsCount}</span>
      </div>
      <div className="report-question-totals">
        <div>
          <span>Ждут ответа</span>
          <strong>{counts?.open ?? summary.unansweredQuestionCount}</strong>
        </div>
        <div>
          <span>Отвеченные</span>
          <strong>{counts?.answered ?? "—"}</strong>
        </div>
        <div>
          <span>Скрытые</span>
          <strong>{counts?.dismissed ?? "—"}</strong>
        </div>
        <Button variant="outline" onClick={onOpen}>
          Открыть вопросы
        </Button>
      </div>
      {query.isError && (
        <div role="alert" className="analytics-load-error">
          <span>История вопросов недоступна. Часть чисел неизвестна.</span>
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Повторить
          </Button>
        </div>
      )}
    </section>
  );
}

export function SignalDistribution({ totals }: { totals: LectureSummary["signalTotals"] }) {
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
  const result = pollAnalytics(polls);
  return (
    <div className="session-analytics__accuracy">
      {result.gradedAnswers > 0 ? (
        <p className="report-accuracy-value">
          <strong>{result.correctAnswers}</strong> из {result.gradedAnswers} верно
        </p>
      ) : (
        <p className="session-analytics__accuracy-empty">Нет оценённых ответов</p>
      )}
      <p className="muted">
        {result.gradedAnswers}{" "}
        {pluralizeRu(
          result.gradedAnswers,
          "оценённый ответ",
          "оценённых ответа",
          "оценённых ответов"
        )}{" "}
        · {result.gradedPollCount}{" "}
        {pluralizeRu(
          result.gradedPollCount,
          "закрытая проверка",
          "закрытые проверки",
          "закрытых проверок"
        )}
      </p>
      {result.ungradedAnswers > 0 && (
        <p className="muted">
          Ещё {result.ungradedAnswers}{" "}
          {pluralizeRu(
            result.ungradedAnswers,
            "ответ без оценки",
            "ответа без оценки",
            "ответов без оценки"
          )}
        </p>
      )}
    </div>
  );
}

function useReportSelection(key: string, fallback = "") {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const explicit = params.has(key) && params.get("summaryList") !== key;
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    if (!window.matchMedia("(max-width: 800px)").matches) return;
    const panel = document.querySelector('[data-slot="tabs-content"][data-state="active"]');
    const target = panel?.querySelector<HTMLElement>(
      explicit ? ".report-mobile-back" : '.report-select-list button[aria-current="true"]'
    );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [value, explicit]);
  function select(nextValue: string) {
    pendingFocus.current = true;
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (nextValue) {
        next.set(key, nextValue);
        next.delete("summaryList");
      } else {
        next.set("summaryList", key);
        if (!next.has(key) && value) next.set(key, value);
      }
      return next;
    });
  }
  return [value, select, explicit] as const;
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
  const [selectedId, select, explicit] = useReportSelection(
    "summarySlide",
    String(summary.problemSlides[0]?.slideIdx ?? "")
  );
  const active =
    summary.problemSlides.find((slide) => String(slide.slideIdx) === selectedId) ??
    summary.problemSlides[0];
  if (!active)
    return (
      <section className="session-analytics__section">
        <h2>Слайды с затруднениями</h2>
        <p className="session-analytics__empty">
          Сигналов «Не понимаю» на слайдах не зафиксировано.
        </p>
      </section>
    );
  return (
    <section
      className={`report-master-detail${explicit ? " has-selection" : ""}`}
      aria-label="Слайды с затруднениями"
    >
      <aside className="report-master">
        <h2>С затруднениями · {summary.problemSlides.length}</h2>
        <ul className="report-select-list">
          {summary.problemSlides.map((slide) => (
            <li key={slide.slideIdx}>
              <button
                type="button"
                aria-current={active.slideIdx === slide.slideIdx ? "true" : undefined}
                onClick={() => select(String(slide.slideIdx))}
              >
                <strong>Слайд {slide.slideIdx}</strong>
                <span className="is-red">Не понимаю: {slide.red}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted">Показаны слайды с красными сигналами.</p>
      </aside>
      <div className="report-detail">
        <Button variant="ghost" className="report-mobile-back" onClick={() => select("")}>
          <ArrowLeft size={17} aria-hidden="true" />К слайдам
        </Button>
        <div className="report-detail__heading">
          <div>
            <h2>Слайд {active.slideIdx}</h2>
            <p className="muted">Сохранённая презентация</p>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Maximize2 size={17} aria-hidden="true" />
                Увеличить
              </Button>
            </DialogTrigger>
            <DialogContent className="session-analytics__slide-dialog">
              <DialogHeader>
                <DialogTitle>Слайд {active.slideIdx}</DialogTitle>
                <DialogDescription>
                  Просмотр сохранённого слайда. Живое занятие и проектор не меняются.
                </DialogDescription>
              </DialogHeader>
              <HistoricalSlideImage
                key={active.slideIdx}
                courseId={courseId}
                deckId={deckId}
                slideIdx={active.slideIdx}
              />
            </DialogContent>
          </Dialog>
        </div>
        <HistoricalSlideImage
          key={active.slideIdx}
          courseId={courseId}
          deckId={deckId}
          slideIdx={active.slideIdx}
        />
        <div className="session-analytics__slide-signals">
          <SignalCount kind="red" label="Не понимаю" value={active.red} />
          <SignalCount kind="yellow" label="Есть вопрос" value={active.yellow} />
          <SignalCount kind="green" label="Понятно" value={active.green} />
          <span>
            Всего: <strong>{active.red + active.yellow + active.green}</strong>
          </span>
        </div>
        <p className="muted">Просмотр сохранённого слайда</p>
      </div>
    </section>
  );
}

function HistoricalSlideImage({
  courseId,
  deckId,
  slideIdx
}: {
  courseId: string;
  deckId: string;
  slideIdx: number;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const query = useQuery({
    queryKey: ["courses", courseId, "decks", deckId, "summary-preview"],
    queryFn: () => getDeck(courseId, deckId)
  });
  const slide = query.data?.slides.find((item) => item.idx === slideIdx);
  async function retry() {
    setState("loading");
    await query.refetch();
    setAttempt((value) => value + 1);
  }
  return (
    <div className="report-slide-image">
      {query.isLoading && (
        <p className="muted" role="status">
          Загрузка слайда…
        </p>
      )}
      {(query.isError || state === "error") && (
        <div className="analytics-load-error" role="alert">
          <p>Не удалось загрузить изображение слайда.</p>
          <Button variant="outline" disabled={query.isFetching} onClick={() => void retry()}>
            Повторить
          </Button>
        </div>
      )}
      {slide && state === "loading" && !query.isError && (
        <p className="muted" role="status">
          Загрузка изображения…
        </p>
      )}
      {slide && (
        <img
          key={attempt}
          src={slideImageUrl(slide)}
          alt={`Слайд ${slideIdx}`}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          hidden={state !== "loaded"}
        />
      )}
      {!query.isLoading && !query.isError && query.data && !slide && (
        <p className="muted">Этот слайд больше недоступен в презентации.</p>
      )}
    </div>
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

function PollResults({ summary, courseId }: { summary: LectureSummary; courseId: string }) {
  const [id, select, explicit] = useReportSelection(
    "summaryPoll",
    summary.pollResults[0]?.pollId ?? ""
  );
  const active = summary.pollResults.find((poll) => poll.pollId === id) ?? summary.pollResults[0];
  if (!active)
    return (
      <section className="session-analytics__section">
        <h2>Проверки</h2>
        <p className="session-analytics__empty">Во время занятия проверок не запускали.</p>
      </section>
    );
  return (
    <section
      className={`report-master-detail${explicit ? " has-selection" : ""}`}
      aria-label="Результаты проверок"
    >
      <aside className="report-master">
        <h2>
          {summary.pollResults.length}{" "}
          {pluralizeRu(summary.pollResults.length, "проверка", "проверки", "проверок")}
        </h2>
        <ul className="report-select-list">
          {summary.pollResults.map((poll, index) => {
            const result = pollAnalytics([poll]);
            return (
              <li key={poll.pollId}>
                <button
                  type="button"
                  aria-current={poll.pollId === active.pollId ? "true" : undefined}
                  onClick={() => select(poll.pollId)}
                >
                  <strong>Проверка {index + 1}</strong>
                  <span>{poll.questionText}</span>
                  <small>
                    {poll.questionType === "SHORT_ANSWER"
                      ? `${poll.totalResponses} текстовых ответов`
                      : result.gradedAnswers
                        ? `${result.correctAnswers} из ${result.gradedAnswers} верно`
                        : "Нет оценённых ответов"}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="report-detail">
        <Button variant="ghost" className="report-mobile-back" onClick={() => select("")}>
          <ArrowLeft size={17} aria-hidden="true" />К проверкам
        </Button>
        <div className="report-detail__heading">
          <h2>Проверка {summary.pollResults.indexOf(active) + 1}</h2>
          <span className="badge">{active.status === "CLOSED" ? "Закрыта" : "Не закрыта"}</span>
        </div>
        {active.questionType === "SHORT_ANSWER" ? (
          <>
            <h3>{active.questionText}</h3>
            <TextPollResponses
              courseId={courseId}
              sessionId={summary.sessionId}
              pollId={active.pollId}
            />
          </>
        ) : (
          <PollResult poll={active} />
        )}
        <p className="muted report-method-note">
          {active.questionType === "SHORT_ANSWER"
            ? "Текстовые ответы не оцениваются автоматически."
            : "Правильность учитывается для закрытых проверок с отмеченным правильным вариантом."}
        </p>
      </div>
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
      {poll.totalResponses === 0 && (
        <p className="session-analytics__empty">
          Ответов нет. Это не показывает, поняла ли аудитория материал.
        </p>
      )}
      <ul className="session-analytics__options">
        {poll.options.map((option, index) => {
          const count = Math.max(0, poll.votes[index] ?? 0);
          const percent = signalShare(count, poll.totalResponses);
          return (
            <li
              key={`${poll.pollId}-${index}`}
              className={
                gradedPoll
                  ? poll.correctOptionIdx === index
                    ? "is-correct"
                    : "is-incorrect"
                  : undefined
              }
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
  const [params, setParams] = useSearchParams();
  const requestedStatus = params.get("summaryQuestionStatus");
  const status: StudentQuestionStatus =
    requestedStatus === "ANSWERED" || requestedStatus === "DISMISSED" ? requestedStatus : "OPEN";
  const search = (params.get("summaryQuestionSearch") ?? "").slice(0, 200);
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const typing = search.trim() !== debounced;
  const [id, select, explicit] = useReportSelection("summaryQuestion");
  const query = useInfiniteQuery({
    queryKey: ["live", courseId, sessionId, "questions", status, debounced],
    queryFn: ({ pageParam, signal }) =>
      getSessionQuestionsPage(courseId, sessionId, status, 50, pageParam, debounced, signal),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined,
    enabled: !typing
  });
  const pages = query.data?.pages ?? [];
  const countCacheRef = useRef(
    new Map<string, { open: number; answered: number; dismissed: number }>()
  );
  const scope = `${courseId}:${sessionId}`,
    counts = pages[0]?.counts;
  if (counts) countCacheRef.current.set(scope, counts);
  const latestCounts = counts ?? countCacheRef.current.get(scope);
  const fallbackOpen = query.isError && status === "OPEN" && pages.length === 0;
  const items = fallbackOpen
    ? fallbackQuestions.filter((question) =>
        question.text.toLocaleLowerCase().includes(debounced.toLocaleLowerCase())
      )
    : Array.from(
        new Map(
          pages.flatMap((page) => page.items).map((question) => [question.id, question])
        ).values()
      );
  const active = items.find((question) => question.id === id) ?? items[0];
  const statusTabs: Array<{ key: StudentQuestionStatus; label: string; count?: number }> = [
    {
      key: "OPEN",
      label: "Ждут ответа",
      count: latestCounts?.open ?? (query.isError ? fallbackOpenCount : undefined)
    },
    { key: "ANSWERED", label: "Отвеченные", count: latestCounts?.answered },
    { key: "DISMISSED", label: "Скрытые", count: latestCounts?.dismissed }
  ];
  function filter(key: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete("summaryQuestion");
        return next;
      },
      { replace: key === "summaryQuestionSearch" }
    );
  }
  return (
    <section
      className={`report-master-detail report-questions${explicit && active ? " has-selection" : ""}`}
      aria-label="История вопросов"
    >
      <aside className="report-master">
        <h2 className="sr-only">Вопросы студентов</h2>
        <div className="session-analytics__question-tabs" role="group" aria-label="Статус вопросов">
          {statusTabs.map((item) => (
            <button
              type="button"
              key={item.key}
              aria-pressed={status === item.key}
              onClick={() => filter("summaryQuestionStatus", item.key)}
            >
              {item.label}
              {item.count !== undefined && <span>{item.count}</span>}
            </button>
          ))}
        </div>
        <SearchField
          value={search}
          onChange={(value) => filter("summaryQuestionSearch", value.slice(0, 200))}
          placeholder="Поиск по тексту вопроса"
        />
        {query.isError && (
          <div className="analytics-load-error" role="alert">
            <p>
              {fallbackOpen
                ? "История недоступна. Показаны открытые вопросы из итоговой сводки."
                : "Не удалось загрузить вопросы. Числа недоступных статусов неизвестны."}
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Повторить
            </Button>
          </div>
        )}
        {(query.isLoading || typing) && (
          <p className="muted" role="status">
            Поиск вопросов…
          </p>
        )}
        {!typing && !query.isLoading && (
          <p className="muted" role="status">
            {fallbackOpen ? `В сводке: ${items.length}` : `Найдено: ${pages[0]?.total ?? 0}`}
          </p>
        )}
        {!typing && !query.isLoading && items.length === 0 && !query.isError && (
          <p className="session-analytics__empty">
            {search
              ? "По этому запросу вопросов нет."
              : status === "OPEN"
                ? "Вопросов, ожидающих ответа, нет."
                : status === "ANSWERED"
                  ? "Сохранённых ответов нет."
                  : "Скрытых вопросов нет."}
          </p>
        )}
        <ul className="report-select-list">
          {!typing &&
            items.map((question) => (
              <li key={question.id}>
                <button
                  type="button"
                  aria-current={question.id === active?.id ? "true" : undefined}
                  onClick={() => select(question.id)}
                >
                  <strong>{question.text}</strong>
                  <span>
                    {question.anonymous ? "Анонимный вопрос" : question.displayName || "Студент"} ·{" "}
                    {formatClock(question.createdAt)}
                  </span>
                  <span
                    className={`session-analytics__question-status is-${question.status.toLowerCase()}`}
                  >
                    {questionStatusLabel(question.status)}
                  </span>
                </button>
              </li>
            ))}
        </ul>
        {query.hasNextPage && !typing && (
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Загрузка…" : "Показать ещё"}
          </Button>
        )}
      </aside>
      <div className="report-detail">
        <Button variant="ghost" className="report-mobile-back" onClick={() => select("")}>
          <ArrowLeft size={17} aria-hidden="true" />К вопросам
        </Button>
        {active && !typing ? (
          <QuestionDetail question={active} />
        ) : (
          <p className="muted">Выберите вопрос из списка.</p>
        )}
      </div>
    </section>
  );
}

function questionStatusLabel(status: StudentQuestionStatus) {
  return status === "OPEN" ? "Ждёт ответа" : status === "ANSWERED" ? "Отвечен" : "Скрыт";
}

function QuestionDetail({ question }: { question: StudentQuestion }) {
  return (
    <article className="report-question-detail">
      <header>
        <p>
          <strong>
            {question.anonymous ? "Анонимный вопрос" : question.displayName || "Студент"}
          </strong>
          <span
            className={`session-analytics__question-status is-${question.status.toLowerCase()}`}
          >
            {questionStatusLabel(question.status)}
          </span>
        </p>
        <p className="muted">{formatDateTime(question.createdAt)}</p>
        <h2>{question.text}</h2>
      </header>
      {question.status === "ANSWERED" && (
        <section>
          <div className="report-detail__heading">
            <h3>Ответ преподавателя</h3>
            <span className="muted">
              {question.answerVisibility === "AUTHOR" ? (
                <>
                  <LockKeyhole size={16} aria-hidden="true" />
                  Только автору
                </>
              ) : question.answerVisibility === "SESSION" ? (
                <>
                  <Globe2 size={16} aria-hidden="true" />
                  Участникам занятия
                </>
              ) : (
                "Область ответа не сохранена"
              )}
            </span>
          </div>
          <p className="report-saved-answer">
            {question.answerText || "Ответ сохранён без текста в итоговой сводке."}
          </p>
          {question.answeredAt && (
            <p className="muted">Ответ в {formatClock(question.answeredAt)}</p>
          )}
        </section>
      )}
      {question.status === "OPEN" && <p className="muted">Вопрос ожидает ответа.</p>}
      {question.status === "DISMISSED" && (
        <p className="muted">Вопрос скрыт. Он не считается отвеченным.</p>
      )}
    </article>
  );
}

function GroupBreakdown({
  summary,
  onOpenParticipants
}: {
  summary: LectureSummary;
  onOpenParticipants: (groupId?: string) => void;
}) {
  return (
    <section
      className="session-analytics__section report-groups"
      aria-labelledby="group-results-title"
    >
      <div className="session-analytics__section-heading">
        <div>
          <h2 id="group-results-title">Результаты по группам</h2>
          <p className="muted">Группы, выбранные для этого занятия.</p>
        </div>
        <Button variant="outline" onClick={() => onOpenParticipants()}>
          Все участники <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
      {summary.groupBreakdowns.length === 0 ? (
        <p className="session-analytics__empty">Занятие проводилось без учебных групп.</p>
      ) : (
        <>
          <div className="report-groups__table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Учебная группа</th>
                  <th>Подключения</th>
                  <th>Сигналы «Не понимаю»</th>
                  <th>Верные ответы</th>
                </tr>
              </thead>
              <tbody>
                {summary.groupBreakdowns.map((group) => {
                  const accuracy = pollAnalytics(group.pollResults);
                  return (
                    <tr key={group.group.id}>
                      <td data-label="Учебная группа">
                        <Button
                          variant="link"
                          className="report-group-members"
                          aria-label={`Показать участников группы ${group.group.name || "Без названия"}`}
                          onClick={() => onOpenParticipants(group.group.id)}
                        >
                          {group.group.name || "Без названия"}
                          <ArrowRight size={16} aria-hidden="true" />
                        </Button>
                      </td>
                      <td data-label="Подключения">{group.participantCount}</td>
                      <td data-label="Сигналы «Не понимаю»">
                        <SignalCount kind="red" label="Не понимаю" value={group.signalTotals.red} />
                      </td>
                      <td data-label="Верные ответы">
                        {accuracy.gradedAnswers ? (
                          <strong>
                            {accuracy.correctAnswers} из {accuracy.gradedAnswers}
                          </strong>
                        ) : (
                          <span className="muted">Нет оценённых ответов</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {summary.groupBreakdowns
            .filter((group) => group.participantCount === 0)
            .map((group) => (
              <p className="report-empty-group muted" key={group.group.id}>
                У группы «{group.group.name}» не было подключений к этому занятию.
              </p>
            ))}
        </>
      )}
      <p className="muted report-method-note">
        Подключения не равны числу уникальных студентов. Исторические группы занятия могут
        отличаться от текущего состава курса. Общие числа могут включать подключения без группы.
      </p>
    </section>
  );
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
