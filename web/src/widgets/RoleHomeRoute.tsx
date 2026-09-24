import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { getMyActiveSession } from "../app/api/live-api";
import { useAuth } from "../app/AuthContext";
import { useMaxBridge } from "../app/max/context";
import { landingPath } from "../app/routes";

export function RoleHomeRoute() {
  const { user } = useAuth();
  const { isMax } = useMaxBridge();
  const canPresent = user && user.role !== "STUDENT";
  const activeSession = useQuery({
    queryKey: ["active-session"],
    queryFn: getMyActiveSession,
    enabled: Boolean(isMax && canPresent),
    retry: 1
  });

  if (isMax && canPresent && activeSession.isLoading) {
    return <div className="route-loading muted">Проверяем текущую лекцию…</div>;
  }
  if (activeSession.data) {
    return (
      <Navigate
        to={`/courses/${activeSession.data.courseId}/sessions/${activeSession.data.sessionId}/presenter`}
        replace
      />
    );
  }
  return <Navigate to={user ? landingPath(user.role) : "/login"} replace />;
}
