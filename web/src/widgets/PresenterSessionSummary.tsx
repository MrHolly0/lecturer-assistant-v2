import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Clock3, MessageSquareText, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { getActivePoll } from "../app/api/interaction-api";
import type { LiveSession, SessionParticipant } from "../app/api/live-api";
import { userErrorMessage } from "../app/api/errors";
import type { StudentEngagement } from "../app/api/student-api";
import { pluralizeRu } from "../shared/lib/plural";

interface PresenterSessionSummaryProps {
  courseId: string;
  session: LiveSession;
  participants: SessionParticipant[];
  engagement?: StudentEngagement;
}

export function PresenterSessionSummary({
  courseId,
  session,
  participants,
  engagement
}: PresenterSessionSummaryProps) {
  const pollQuery = useQuery({
    queryKey: ["poll", courseId, session.id, "active"],
    queryFn: () => getActivePoll(courseId, session.id)
  });
  const duration = formatDuration(session.startedAt, session.endedAt);
  const participantCount = useMemo(
    () => new Set(participants.map((participant) => participant.personId)).size,
    [participants]
  );
  const signalTotals = useMemo(
    () =>
      (engagement?.problemSlides ?? []).reduce(
        (total, slide) => ({
          green: total.green + slide.signals.green,
          yellow: total.yellow + slide.signals.yellow,
          red: total.red + slide.signals.red,
          total: total.total + slide.signals.total
        }),
        { green: 0, yellow: 0, red: 0, total: 0 }
      ),
    [engagement?.problemSlides]
  );
  const poll = pollQuery.data;

  return (
    <main className="session-summary-shell">
      <header className="session-summary-header">
        <div>
          <span className="session-summary-kicker">Лекция завершена</span>
          <h1>{session.lectureTitle}</h1>
          <p className="muted">Краткий итог занятия доступен сразу после завершения.</p>
        </div>
        <Link to={`/courses/${courseId}/materials`} className="btn-ghost session-summary-back">
          <ArrowLeft size={17} />
          К материалам
        </Link>
      </header>

      <section className="session-summary-metrics" aria-label="Основные показатели">
        <SummaryMetric icon={Clock3} label="Длительность" value={duration} />
        <SummaryMetric
          icon={UsersRound}
          label="Участники"
          value={`${participantCount} ${pluralizeRu(participantCount, "студент", "студента", "студентов")}`}
        />
        <SummaryMetric
          icon={BarChart3}
          label="Сигналы"
          value={`${signalTotals.total} ${pluralizeRu(signalTotals.total, "сигнал", "сигнала", "сигналов")}`}
        />
        <SummaryMetric
          icon={MessageSquareText}
          label="Вопросы"
          value={`${engagement?.questions.length ?? 0} ${pluralizeRu(engagement?.questions.length ?? 0, "вопрос", "вопроса", "вопросов")}`}
        />
      </section>

      <div className="session-summary-grid">
        <section className="session-summary-section">
          <div className="section-heading">
            <h2>Где было непонятно</h2>
            <span className="muted">по сигналам аудитории</span>
          </div>
          {(engagement?.problemSlides.length ?? 0) === 0 ? (
            <p className="muted">Проблемных слайдов не зафиксировано.</p>
          ) : (
            <ol className="summary-problem-list">
              {engagement?.problemSlides.slice(0, 6).map((item) => (
                <li key={item.slideIdx}>
                  <strong>Слайд {item.slideIdx}</strong>
                  <span>{item.signals.red} не понимают</span>
                  <span>{item.signals.yellow} есть вопрос</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="session-summary-section">
          <div className="section-heading">
            <h2>Последняя проверка</h2>
            {poll && (
              <span className="muted">
                {poll.totalResponses}{" "}
                {pluralizeRu(poll.totalResponses, "ответ", "ответа", "ответов")}
              </span>
            )}
          </div>
          {pollQuery.isLoading && <p className="muted">Загрузка результата…</p>}
          {pollQuery.isError && (
            <p className="form-error" role="alert">
              {userErrorMessage(pollQuery.error, "Не удалось загрузить результат проверки.")}
            </p>
          )}
          {!pollQuery.isLoading && !pollQuery.isError && !poll && (
            <p className="muted">Во время лекции проверок не запускали.</p>
          )}
          {poll && (
            <div className="summary-poll">
              <h3>{poll.poll.questionText}</h3>
              {poll.poll.options.map((option, index) => {
                const count = poll.votes[index] ?? 0;
                const percent =
                  poll.totalResponses > 0 ? Math.round((count / poll.totalResponses) * 100) : 0;
                return (
                  <div
                    key={index}
                    className={`summary-poll-row${poll.poll.correctOptionIdx === index ? " summary-poll-row--correct" : ""}`}
                  >
                    <span>{option}</span>
                    <div><i style={{ width: `${percent}%` }} /></div>
                    <strong>{percent}%</strong>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
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

function formatDuration(startedAt?: string, endedAt?: string) {
  if (!startedAt || !endedAt) return "—";
  const seconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${Math.max(1, minutes)} мин`;
}
