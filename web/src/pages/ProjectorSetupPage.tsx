import { Navigate, useSearchParams } from "react-router-dom";

export function ProjectorSetupPage() {
  const [query] = useSearchParams();
  const courseId = query.get("courseId");
  const sessionId = query.get("sessionId");
  if (courseId && sessionId)
    return (
      <Navigate
        replace
        to={`/courses/${encodeURIComponent(courseId)}/sessions/${encodeURIComponent(sessionId)}/presenter?projector=setup`}
      />
    );
  return <Navigate replace to="/courses" />;
}
