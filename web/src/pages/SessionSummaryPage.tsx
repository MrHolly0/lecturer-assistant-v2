import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { getCourse } from "../app/api/courses-api";
import { getLiveSession } from "../app/api/live-api";
import { AppHeader } from "../widgets/Layout";
import { Button } from "../shared/ui/button";
import { PresenterSessionSummary } from "../widgets/PresenterSessionSummary";

export function SessionSummaryPage({
  courseId,
  sessionId
}: {
  courseId: string;
  sessionId: string;
}) {
  const courseQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const canManage = courseQuery.data?.canManage ?? false;
  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: () => getLiveSession(courseId, sessionId),
    enabled: canManage
  });

  if (courseQuery.isLoading || (canManage && sessionQuery.isLoading)) {
    return <div className="route-loading muted">Загрузка итога…</div>;
  }
  if (courseQuery.data && !canManage) return <Navigate to={`/courses/${courseId}`} replace />;
  if (courseQuery.isError || sessionQuery.isError || !sessionQuery.data) {
    return (
      <>
        <AppHeader />
        <div className="page preparation-page action-message" role="alert">
          <p className="form-error">Не удалось открыть итог лекции.</p>
          <Button
            variant="outline"
            onClick={() => {
              void courseQuery.refetch();
              if (canManage) void sessionQuery.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <PresenterSessionSummary
        courseId={courseId}
        session={sessionQuery.data}
        backTo={`/courses/${courseId}/analytics`}
        backLabel="К аналитике"
      />
    </>
  );
}
