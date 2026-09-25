import type { LearningMetrics } from "../app/api/analytics-api";

export function LearningMetricsView({
  metrics,
  compact = false
}: {
  metrics: LearningMetrics;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "learning-metrics learning-metrics--compact" : "learning-metrics"}>
      <div className="learning-metric">
        <span>Посещаемость</span>
        <strong>{metrics.participantCount}</strong>
        <small>
          участников · {metrics.sessionAttendances} посещений
          {metrics.memberCount > 0 ? ` · ${metrics.memberCount} в составе` : ""}
        </small>
      </div>
      <div className="learning-metric">
        <span>Сигналы понимания</span>
        {metrics.signalCount === 0 ? (
          <strong className="learning-metric__empty">Сигналов нет</strong>
        ) : (
          <>
            <strong>{metrics.signalCount}</strong>
            <div className="learning-signal-split" aria-label="Доли среди полученных сигналов">
              <span className="learning-signal learning-signal--green">
                Понятно {ratio(metrics.greenShare)} · {metrics.greenSignals}/{metrics.signalCount}
              </span>
              <span className="learning-signal learning-signal--yellow">
                Вопрос {ratio(metrics.yellowShare)} · {metrics.yellowSignals}/{metrics.signalCount}
              </span>
              <span className="learning-signal learning-signal--red">
                Не понимаю {ratio(metrics.redShare)} · {metrics.redSignals}/{metrics.signalCount}
              </span>
            </div>
            <small>Доли среди полученных сигналов, не среди студентов</small>
          </>
        )}
      </div>
      <div className="learning-metric">
        <span>Проверки</span>
        {metrics.checkAnswers === 0 ? (
          <strong className="learning-metric__empty">Ответов нет</strong>
        ) : metrics.gradedAnswers === 0 ? (
          <>
            <strong>{metrics.checkAnswers}</strong>
            <small>Нет оценённых ответов</small>
          </>
        ) : (
          <>
            <strong>{ratio(metrics.correctRate)}</strong>
            <small>
              {metrics.correctAnswers} из {metrics.gradedAnswers} оценённых ответов верные
            </small>
          </>
        )}
      </div>
      <div className="learning-metric">
        <span>Вопросы</span>
        {metrics.questionsAsked === 0 ? (
          <strong className="learning-metric__empty">Вопросов нет</strong>
        ) : (
          <>
            <strong>{metrics.questionsAsked}</strong>
            <small>Отвечено: {metrics.questionsAnswered}</small>
          </>
        )}
      </div>
    </div>
  );
}

function ratio(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}
