import { useQuery } from "@tanstack/react-query";
import { CircleAlert, ArrowRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { getLectureSummary } from "../app/api/live-api";
import { formatSessionDuration, formatSessionPeriod } from "../shared/lib/analyticsNavigation";
import { pollAnalytics } from "../shared/lib/sessionAnalytics";
import { Button, LinkButton } from "../shared/ui/button";
import { SignalDistribution } from "./PresenterSessionSummary";
import { SessionGroups } from "./SessionGroups";

export function CourseSessionPreview({
  courseId,
  sessionId
}: {
  courseId: string;
  sessionId: string;
}) {
  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: ["live", courseId, sessionId, "summary"],
    queryFn: () => getLectureSummary(courseId, sessionId)
  });
  function link(tab = "overview") {
    const next = new URLSearchParams(params);
    next.set("historySession", sessionId);
    next.delete("historyList");
    next.set("summaryTab", tab);
    return `/courses/${courseId}/sessions/${sessionId}/summary?${next}`;
  }
  if (query.isLoading)
    return (
      <p className="muted" role="status">
        Загрузка итога занятия…
      </p>
    );
  if (query.isError || !query.data)
    return (
      <div className="analytics-load-error" role="alert">
        <p>Не удалось загрузить итог занятия.</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Повторить
        </Button>
      </div>
    );
  const summary = query.data,
    accuracy = pollAnalytics(summary.pollResults);
  const attention = [
    { count: summary.problemSlides.length, text: "Слайды с затруднениями", tab: "slides" },
    { count: summary.unansweredQuestionCount, text: "Вопросы без ответа", tab: "questions" }
  ].filter((item) => item.count > 0);
  return (
    <article className="session-history-preview" aria-label="Быстрый итог занятия">
      <header className="session-history-preview__header">
        <div>
          <h2>{summary.lectureTitle}</h2>
          <p className="muted">
            {formatSessionPeriod(summary.startedAt, summary.endedAt)} ·{" "}
            {formatSessionDuration(summary.durationSeconds)}
          </p>
          <SessionGroups groups={summary.groups} compact />
        </div>
        <LinkButton variant="outline" to={link()}>
          Открыть полный итог
        </LinkButton>
      </header>
      <section>
        <h3>Требует внимания</h3>
        {attention.length ? (
          attention.map((item) => (
            <LinkButton
              variant="ghost"
              className="session-history-preview__attention"
              key={item.tab}
              to={link(item.tab)}
            >
              <CircleAlert size={20} aria-hidden="true" />
              <span>
                {item.text}: {item.count}
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </LinkButton>
          ))
        ) : (
          <p className="muted">Красных сигналов и вопросов, ожидающих ответа, нет.</p>
        )}
      </section>
      <section>
        <h3>Сохранённые сигналы</h3>
        <p className="muted">Последний сигнал подключения на каждом слайде.</p>
        <SignalDistribution totals={summary.signalTotals} />
      </section>
      <section>
        <h3>Проверки</h3>
        {accuracy.gradedAnswers > 0 ? (
          <p className="session-history-preview__accuracy">
            <strong>
              {accuracy.correctAnswers} из {accuracy.gradedAnswers}
            </strong>{" "}
            верных ответов
          </p>
        ) : (
          <p className="muted">Нет оценённых ответов</p>
        )}
        <p className="muted">Учитываются закрытые проверки с правильным вариантом.</p>
      </section>
      <section>
        <h3>Вопросы</h3>
        {summary.unansweredQuestions.slice(0, 3).map((question) => (
          <div className="session-history-preview__question" key={question.id}>
            <p>{question.text}</p>
            <span className="badge">Без ответа</span>
          </div>
        ))}
        {!summary.unansweredQuestions.length && (
          <p className="muted">Вопросов, ожидающих ответа, нет.</p>
        )}
        <LinkButton variant="ghost" to={link("questions")}>
          Открыть вопросы <ArrowRight size={16} aria-hidden="true" />
        </LinkButton>
      </section>
    </article>
  );
}
