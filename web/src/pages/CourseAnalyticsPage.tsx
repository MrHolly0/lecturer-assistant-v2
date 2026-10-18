import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { getCourse } from "../app/api/courses-api";
import { Button } from "../shared/ui/button";
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
