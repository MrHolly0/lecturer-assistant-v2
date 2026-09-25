import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Clock3, MessageSquareText, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { userErrorMessage } from "../app/api/errors";
import { getLectureSummary, type LectureSummary, type LiveSession } from "../app/api/live-api";
import { pluralizeRu } from "../shared/lib/plural";

interface PresenterSessionSummaryProps {
  courseId: string;
  session: LiveSession;
}

export function PresenterSessionSummary({ courseId, session }: PresenterSessionSummaryProps) {
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
          <p className="muted">Итог занятия сформирован по данным живой сессии.</p>
        </div>
        <Link to={`/courses/${courseId}/materials`} className="btn-ghost session-summary-back">
          <ArrowLeft size={17} />
          К материалам
        </Link>
      </header>

      {summaryQuery.isLoading && <p className="muted">Собираем итог лекции…</p>}
      {summaryQuery.isError && (
        <section className="session-summary-error" role="alert">
          <p>{userErrorMessage(summaryQuery.error, "Не удалось загрузить итог лекции.")}</p>
          <button type="button" className="btn-ghost" onClick={() => summaryQuery.refetch()}>
            Повторить
          </button>
        </section>
      )}

      {summary && (
        <>
          <section className="session-summary-metrics" aria-label="Основные показатели">
            <SummaryMetric
              icon={Clock3}
              label="Длительность"
              value={formatDuration(summary.durationSeconds)}
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

          <div className="session-summary-grid">
            <ProblemSlides summary={summary} />
            <PollResults summary={summary} />
          </div>
        </>
      )}
    </main>
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
                    <div><i style={{ width: `${percent}%` }} /></div>
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

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${Math.max(1, minutes)} мин`;
}
