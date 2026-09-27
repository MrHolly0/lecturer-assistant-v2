import type { MaxEnvironment } from "./bridge";

export function isMobileMax(environment: Pick<MaxEnvironment, "isMax" | "platform">): boolean {
  return (
    environment.isMax && (environment.platform === "ios" || environment.platform === "android")
  );
}

export function teacherRemotePath(courseId: string, sessionId: string): string {
  return `/courses/${courseId}/sessions/${sessionId}/remote`;
}

export function canRedirectToTeacherRemote(pathname: string): boolean {
  if (pathname.startsWith("/s/")) return false;
  if (pathname.startsWith("/projection/")) return false;
  if (pathname.startsWith("/courses")) return false;
  if (pathname.startsWith("/settings/")) return false;
  if (pathname.endsWith("/projection")) return false;
  if (pathname.endsWith("/join")) return false;
  if (pathname.endsWith("/summary")) return false;
  return !pathname.endsWith("/remote");
}
