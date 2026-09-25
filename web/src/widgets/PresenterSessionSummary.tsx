import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  Clock3,
  MessageSquareText,
  PauseCircle,
  PlayCircle,
  UsersRound
} from "lucide-react";
import { userErrorMessage } from "../app/api/errors";
import { getLectureSummary, type LectureSummary, type LiveSession } from "../app/api/live-api";
import { pluralizeRu } from "../shared/lib/plural";
import { Button, LinkButton } from "../shared/ui/button";
import { SessionGroups } from "./SessionGroups";

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
    <main className="session-summary-shell">
      <header className="session-summary-header">
        <div>
          <span className="session-summary-kicker">Лекция завершена</span>
          <h1>{summary?.lectureTitle ?? session.lectureTitle}</h1>
          <SessionGroups groups={summary?.groups ?? session.groups} />
          <p className="muted">Итог занятия сформирован по данным живой сессии.</p>
        </div>
        <LinkButton to={backTo} variant="ghost" className="session-summary-back">
          <ArrowLeft size={17} />
          {backLabel}
        </LinkButton>
      </header>

      {summaryQuery.isLoading && <p className="muted">Собираем итог лекции…</p>}
      {summaryQuery.isError && (
        <section className="session-summary-error" role="alert">
          <p>{userErrorMessage(summaryQuery.error, "Не удалось загрузить итог лекции.")}</p>
          <Button type="button" variant="outline" onClick={() => summaryQuery.refetch()}>
            Повторить
          </Button>
        </section>
      )}

      {summary && (
        <>
          <section className="session-summary-metrics" aria-label="Основные показатели">
            <SummaryMetric
              icon={Clock3}
              label="Общее время"
              value={formatDuration(summary.durationSeconds)}
            />
            <SummaryMetric
              icon={PlayCircle}
              label="В эфире"
              value={formatDuration(summary.activeDurationSeconds)}
            />
            <SummaryMetric
              icon={PauseCircle}
              label="На паузе"
              value={formatDuration(summary.pausedDurationSeconds, true)}
            />
            <SummaryMetric
              icon={UsersRound}
              label="Участники"
              value={`${summary.participantCount} ${pluralizeRu(summary.participantCount, "студент", "студента", "студентов")}`}
            />
            <SummaryMetric
              icon={BarChart3}
              label="Сигналы"
              value={`${summary.signalTotals.total} ${pluralizeRu(summary.signalTotals.total, "сигнал", "сигнала", "сигналов")}`}
            />
            <SummaryMetric
              icon={MessageSquareText}
              label="Вопросы без ответа"
              value={`${summary.unansweredQuestionCount} из ${summary.questionsCount}`}
            />
          </section>

          <SessionGroupBreakdown summary={summary} />

          <div className="session-summary-grid">
            <ProblemSlides summary={summary} />
            <PollResults summary={summary} />
          </div>
        </>
      )}
    </main>
  );
}

function SessionGroupBreakdown({ summary }: { summary: LectureSummary }) {
  if (summary.groupBreakdowns.length === 0) return null;

  return (
    <section className="session-group-breakdown">
      <div className="section-heading">
        <h2>Результаты по группам</h2>
        <span className="muted">сравнение внутри общего занятия</span>
      </div>
      <div className="session-group-breakdown__list">
        {summary.groupBreakdowns.map((breakdown) => {
          const pollResponses = breakdown.pollResults.reduce(
            (total, poll) => total + poll.totalResponses,
            0
          );
          const problemSlide = breakdown.problemSlides[0];
          return (
            <div key={breakdown.group.id} className="session-group-breakdown__item">
              <strong>{breakdown.group.name}</strong>
              <GroupMetric
                value={breakdown.participantCount}
                label={pluralizeRu(
                  breakdown.participantCount,
                  "участник",
                  "участника",
                  "участников"
                )}
              />
              <GroupMetric value={breakdown.signalTotals.red} label="не понимают" alert />
              <GroupMetric value={pollResponses} label="ответов на проверки" />
              <GroupMetric value={breakdown.questionsCount} label="вопросов" />
              <span className="session-group-breakdown__problem">
                {problemSlide
                  ? `Сложнее всего: слайд ${problemSlide.slideIdx}`
                  : "Проблемных слайдов нет"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GroupMetric({
  value,
  label,
  alert = false
}: {
  value: number;
  label: string;
  alert?: boolean;
}) {
  return (
    <span className={alert && value > 0 ? "session-group-breakdown__metric--alert" : undefined}>
      <strong>{value}</strong> {label}
    </span>
  );
}

function ProblemSlides({ summary }: { summary: LectureSummary }) {
  return (
    <section className="session-summary-section">
      <div className="section-heading">
        <h2>Где было непонятно</h2>
        <span className="muted">по сигналам аудитории</span>
      </div>
      {summary.problemSlides.length === 0 ? (
        <p className="muted">Красных сигналов не зафиксировано.</p>
      ) : (
        <ol className="summary-problem-list">
          {summary.problemSlides.map((item) => (
            <li key={item.slideIdx}>
              <strong>Слайд {item.slideIdx}</strong>
              <span>{item.red} не понимают</span>
              <span>{item.yellow} есть вопрос</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PollResults({ summary }: { summary: LectureSummary }) {
  return (
    <section className="session-summary-section">
      <div className="section-heading">
        <h2>Проверки</h2>
        <span className="muted">
          {summary.pollResults.length}{" "}
          {pluralizeRu(summary.pollResults.length, "опрос", "опроса", "опросов")}
        </span>
      </div>
      {summary.pollResults.length === 0 ? (
        <p className="muted">Во время лекции проверок не запускали.</p>
      ) : (
        <div className="summary-poll-list">
          {summary.pollResults.map((poll) => (
            <article className="summary-poll" key={poll.pollId}>
              <h3>{poll.questionText}</h3>
              {poll.options.map((option, index) => {
                const count = poll.votes[index] ?? 0;
                const percent =
                  poll.totalResponses > 0 ? Math.round((count / poll.totalResponses) * 100) : 0;
                return (
                  <div
                    key={index}
                    className={`summary-poll-row${poll.correctOptionIdx === index ? " summary-poll-row--correct" : ""}`}
                  >
                    <span>{option}</span>
                    <div>
                      <i style={{ width: `${percent}%` }} />
                    </div>
                    <strong>{percent}%</strong>
                  </div>
                );
              })}
              <small className="muted">
                {poll.totalResponses}{" "}
                {pluralizeRu(poll.totalResponses, "ответ", "ответа", "ответов")}
              </small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <article className="session-summary-metric">
      <Icon size={20} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatDuration(seconds: number, allowZero = false) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (allowZero && seconds === 0) return "0 мин";
  return `${Math.max(1, minutes)} мин`;
}
