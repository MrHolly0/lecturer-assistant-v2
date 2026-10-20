import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesColumn } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { getCourse } from "../app/api/courses-api";
import { listSessionHistory } from "../app/api/live-api";
import { getCourseGroupAnalytics } from "../app/api/analytics-api";
import { Button, LinkButton } from "../shared/ui/button";
import { CourseSectionNav } from "../widgets/CourseSectionNav";
import { CourseLearningAnalytics } from "../widgets/CourseLearningAnalytics";
import { CourseSessionHistory } from "../widgets/CourseSessionHistory";

export function CourseAnalyticsPage({ courseId }: { courseId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const courseQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const canManage = courseQuery.data?.canManage ?? false;
  const historyQuery = useQuery({
    queryKey: ["live", courseId, "history", "availability"],
    queryFn: () => listSessionHistory(courseId, 1, 0),
    enabled: canManage
  });
  const activityQuery = useQuery({
    queryKey: ["analytics", courseId, "groups"],
    queryFn: () => getCourseGroupAnalytics(courseId),
    enabled: canManage
  });
  const hasHistoryFilters = [
    "historySearch",
    "historyGroup",
    "historyFrom",
    "historyTo",
    "student"
  ].some((key) => searchParams.get(key));
  const metrics = activityQuery.data;
  const noActivity =
    metrics &&
    [metrics.overall, metrics.unidentified, ...metrics.groups.map((group) => group.metrics)].every(
      (item) =>
        item.participantCount + item.signalCount + item.checkAnswers + item.questionsAsked === 0
    );
  const empty =
    !hasHistoryFilters &&
    !historyQuery.isError &&
    !activityQuery.isError &&
    historyQuery.data?.total === 0 &&
    noActivity;
  if (courseQuery.isLoading) return <AnalyticsLoading />;
  if (courseQuery.data && !canManage) return <Navigate to={`/courses/${courseId}`} replace />;
  if (courseQuery.isError || !courseQuery.data) {
    return (
      <AnalyticsError
        message="Курс не найден или нет доступа."
        onRetry={courseQuery.isError ? () => void courseQuery.refetch() : undefined}
      />
    );
  }

  return (
    <div className="page page--wide analytics-page course-workflows preparation-page">
      <header className="page-header analytics-page__header course-workflow-header">
        <div className="course-workflow-header__copy">
          <Link to={`/courses/${courseId}`} className="breadcrumb">
            ← Курсы / {courseQuery.data.title}
          </Link>
          <h1>Аналитика курса</h1>
        </div>
      </header>
      <CourseSectionNav courseId={courseId} canManage />
      {empty ? (
        <div className="lecture-empty-state">
          <ChartNoAxesColumn size={28} aria-hidden="true" />
          <div>
            <strong>Результаты появятся после первого занятия</strong>
            <p className="muted">
              Здесь будут история занятий, обратная связь и результаты проверок.
            </p>
          </div>
          <LinkButton to={`/courses/${courseId}/materials`}>Подготовить занятие</LinkButton>
        </div>
      ) : historyQuery.isLoading || activityQuery.isLoading ? (
        <p role="status" className="muted">
          Загрузка аналитики…
        </p>
      ) : (
        <>
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

          <CourseSessionHistory key={courseId} courseId={courseId} />
        </>
      )}
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

function AnalyticsError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="page">
      <p className="form-error">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}
