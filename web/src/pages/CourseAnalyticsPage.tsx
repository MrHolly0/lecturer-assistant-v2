import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarClock } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { getCourse } from "../app/api/courses-api";
import { listSessionHistory } from "../app/api/live-api";
import { LinkButton } from "../shared/ui/button";
import { CourseSectionNav } from "../widgets/CourseSectionNav";
import { PaginationBar } from "../widgets/ListControls";
import { CourseLearningAnalytics } from "../widgets/CourseLearningAnalytics";
import { SessionGroups } from "../widgets/SessionGroups";

const PAGE_SIZE = 20;

export function CourseAnalyticsPage({ courseId }: { courseId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const courseQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const canManage = courseQuery.data?.canManage ?? false;
  const historyQuery = useQuery({
    queryKey: ["live", courseId, "history", page],
    queryFn: () => listSessionHistory(courseId, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    enabled: canManage,
    placeholderData: keepPreviousData
  });
  const history = historyQuery.data;
  const pageCount = Math.max(1, Math.ceil((history?.total ?? 0) / PAGE_SIZE));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  if (courseQuery.isLoading) return <AnalyticsLoading />;
  if (courseQuery.data && !canManage) return <Navigate to={`/courses/${courseId}`} replace />;
  if (courseQuery.isError || !courseQuery.data) {
    return <AnalyticsError message="Курс не найден или нет доступа." />;
  }

  return (
    <div className="page page--wide analytics-page">
      <header className="page-header analytics-page__header">
        <div>
          <Link to={`/courses/${courseId}`} className="breadcrumb">
            ← Курс
          </Link>
          <h1>Аналитика</h1>
          <p className="muted">Завершённые лекции и результаты проведённых проверок.</p>
        </div>
      </header>
      <CourseSectionNav courseId={courseId} canManage />
      <CourseLearningAnalytics
        courseId={courseId}
        initialStudentId={searchParams.get("student") ?? ""}
        onStudentChange={(studentId) => {
          const next = new URLSearchParams(searchParams);
          if (studentId) next.set("student", studentId);
          else next.delete("student");
          setSearchParams(next, { replace: true });
        }}
      />

      <section className="session-history" aria-labelledby="session-history-title">
        <div className="section-heading session-history__heading">
          <div>
            <h2 id="session-history-title">История лекций</h2>
            <p className="muted">Новые занятия отображаются первыми.</p>
          </div>
          {history && <span className="badge">{history.total}</span>}
        </div>

        {historyQuery.isLoading && <p className="muted">Загрузка истории…</p>}
        {historyQuery.isError && (
          <div className="form-error" role="alert">
            Не удалось загрузить историю лекций.
          </div>
        )}
        {history && history.items.length === 0 && (
          <div className="session-history-empty">
            <BarChart3 size={24} aria-hidden="true" />
            <div>
              <strong>Завершённых лекций пока нет</strong>
              <p className="muted">После занятия здесь появятся сигналы и результаты проверок.</p>
            </div>
          </div>
        )}
        {history && history.items.length > 0 && (
          <ul className="session-history-list">
            {history.items.map((session) => (
              <li key={session.id} className="session-history-row">
                <div className="session-history-row__copy">
                  <h3>{session.lectureTitle}</h3>
                  <SessionGroups groups={session.groups} compact />
                  <span className="session-history-row__time">
                    <CalendarClock size={15} aria-hidden="true" />
                    {formatDateTime(session.endedAt ?? session.startedAt)}
                  </span>
                </div>
                <span className="badge badge--muted">
                  {session.status === "ARCHIVED" ? "В архиве" : "Завершена"}
                </span>
                <LinkButton
                  variant="outline"
                  to={`/courses/${courseId}/sessions/${session.id}/summary`}
                >
                  Открыть итог
                </LinkButton>
              </li>
            ))}
          </ul>
        )}
        {history && (
          <PaginationBar
            page={page}
            pageCount={pageCount}
            pageSize={PAGE_SIZE}
            total={history.total}
            onPageChange={setPage}
          />
        )}
      </section>
    </div>
  );
}

function AnalyticsLoading() {
  return (
    <div className="page">
      <p className="muted">Загрузка…</p>
    </div>
  );
}

function AnalyticsError({ message }: { message: string }) {
  return (
    <div className="page">
      <p className="form-error">{message}</p>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
