import type { components } from "./schema";
import { getStoredAuth } from "../auth";
import { apiFetch, ApiError } from "./http";

export type StudentSessionSnapshot = components["schemas"]["StudentSessionSnapshot"];
export type StudentJoinResponse = components["schemas"]["StudentJoinResponse"];
export type SignalAggregate = components["schemas"]["SignalAggregate"];
export type SignalValue = components["schemas"]["SignalValue"];
export type StudentQuestion = components["schemas"]["StudentQuestion"];
export type StudentEngagement = components["schemas"]["StudentEngagement"];

export async function publicFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  if (!response.ok) {
    let message = `Запрос завершился с ошибкой ${response.status}`;
    try {
      const data = (await response.clone().json()) as { message?: string; detail?: string };
      message = data.message ?? data.detail ?? message;
    } catch {
      // non-json response body
    }
    throw new ApiError(response.status, message);
  }
  return response;
}

export function studentFetch(path: string, init?: RequestInit): Promise<Response> {
  return getStoredAuth() ? apiFetch(path, init) : publicFetch(path, init);
}

export async function getStudentSession(
  joinCode: string,
  participantToken = ""
): Promise<StudentSessionSnapshot> {
  const headers = new Headers();
  if (!getStoredAuth() && participantToken) {
    headers.set("X-Participant-Token", participantToken);
  }
  const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}`, { headers });
  return res.json() as Promise<StudentSessionSnapshot>;
}

export async function joinStudentSession(
  joinCode: string,
  displayName?: string
): Promise<StudentJoinResponse> {
  const authenticated = Boolean(getStoredAuth());
  const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/join`, {
    method: "POST",
    body: authenticated ? undefined : JSON.stringify({ displayName })
  });
  return res.json() as Promise<StudentJoinResponse>;
}

export async function submitStudentSignal(
  joinCode: string,
  participantToken: string,
  value: SignalValue
): Promise<SignalAggregate> {
  const authenticated = Boolean(getStoredAuth());
  const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/signals`, {
    method: "POST",
    body: JSON.stringify(authenticated ? { value } : { participantToken, value })
  });
  return res.json() as Promise<SignalAggregate>;
}

export async function askStudentQuestion(
  joinCode: string,
  participantToken: string,
  text: string
): Promise<StudentQuestion> {
  const authenticated = Boolean(getStoredAuth());
  const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/questions`, {
    method: "POST",
    body: JSON.stringify(authenticated ? { text } : { participantToken, text })
  });
  return res.json() as Promise<StudentQuestion>;
}

export async function getStudentEngagement(
  courseId: string,
  sessionId: string
): Promise<StudentEngagement> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/engagement`);
  return res.json() as Promise<StudentEngagement>;
}

export function connectStudentSession(
  joinCode: string,
  participantToken: string,
  onSnapshot: (snapshot: StudentSessionSnapshot) => void
) {
  const params = new URLSearchParams({ participantToken });
  const source = new EventSource(
    `/api/v1/student/sessions/${encodeURIComponent(joinCode)}/events?${params}`
  );
  source.addEventListener("snapshot", (event) => {
    onSnapshot(JSON.parse((event as MessageEvent).data) as StudentSessionSnapshot);
  });
  return () => source.close();
}
