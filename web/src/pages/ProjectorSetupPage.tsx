import { Navigate, useSearchParams } from "react-router-dom";
import { ProjectorSetup } from "../widgets/ProjectorSetup";

export function ProjectorSetupPage() {
  const [query] = useSearchParams();
  const courseId = query.get("courseId");
  const sessionId = query.get("sessionId");
  const joinCode = query.get("joinCode") ?? "";
  if (courseId && sessionId)
    return (
      <Navigate
        replace
        to={`/courses/${encodeURIComponent(courseId)}/sessions/${encodeURIComponent(sessionId)}/presenter?projector=setup`}
      />
    );
  return <ProjectorSetup joinCode={joinCode} />;
}
