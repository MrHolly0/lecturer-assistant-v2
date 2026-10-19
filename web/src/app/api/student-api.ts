import type { components } from "./schema";
import { getStoredAuth } from "../auth";
import { apiErrorFromResponse } from "./errors";
import { apiFetch } from "./http";
import { StudentSnapshotGate } from "./student-snapshot-gate";

type GeneratedStudentSessionSnapshot = components["schemas"]["StudentSessionSnapshot"];

export type StudentSessionGroup = components["schemas"]["SessionGroup"];

export type StudentActivePoll = components["schemas"]["ActivePollView"];
export type StudentSessionSnapshot = Omit<GeneratedStudentSessionSnapshot, "activePoll"> & {
  activePoll?: StudentActivePoll | null;
};
export type StudentJoinResponse = components["schemas"]["StudentJoinResponse"];
export type SignalAggregate = components["schemas"]["SignalAggregate"];
export type SignalValue = components["schemas"]["SignalValue"];
export type StudentQuestion = components["schemas"]["StudentQuestion"];
export type StudentQuestionStatus = StudentQuestion["status"];
export type SessionQuestionPage = components["schemas"]["SessionQuestionPage"];
export type StudentQuestionAnswer = components["schemas"]["StudentQuestionAnswer"];
export type UpdateStudentQuestionRequest = components["schemas"]["UpdateStudentQuestionRequest"];
export type StudentEngagement = components["schemas"]["StudentEngagement"];
export type StudentActiveSessionSummary = components["schemas"]["StudentActiveSessionSummary"];
export type StudentConnectionState =
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "POLLING"
  | "OFFLINE"
  | "ENDED";

export interface StudentConnectionControls {
  disconnect: () => void;
  reconnect: () => void;
}

export async function publicFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response;
}

export function studentFetch(path: string, init?: RequestInit): Promise<Response> {
  return getStoredAuth() ? apiFetch(path, init) : publicFetch(path, init);
}

export async function getMyStudentActiveSession(): Promise<StudentActiveSessionSummary | null> {
  const response = await apiFetch("/me/student-active-session");
  if (response.status === 204) return null;
  return response.json() as Promise<StudentActiveSessionSummary>;
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

export async function getPublicStudentSession(joinCode: string): Promise<StudentSessionSnapshot> {
  const res = await publicFetch(`/student/sessions/${encodeURIComponent(joinCode)}`);
  return res.json() as Promise<StudentSessionSnapshot>;
}

export async function joinStudentSession(
  joinCode: string,
  displayName?: string,
  groupId?: string,
  participantToken?: string
): Promise<StudentJoinResponse> {
  const authenticated = Boolean(getStoredAuth());
  const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/join`, {
    method: "POST",
    body: JSON.stringify(
      authenticated ? { groupId, participantToken } : { displayName, groupId, participantToken }
    )
  });
  return res.json() as Promise<StudentJoinResponse>;
}

export async function submitStudentName(
  joinCode: string,
  participantToken: string,
  lastName: string,
  firstName: string
): Promise<StudentSessionSnapshot> {
  const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/name`, {
    method: "POST",
    body: JSON.stringify({ participantToken, lastName, firstName })
  });
  return res.json() as Promise<StudentSessionSnapshot>;
}

export async function sendStudentSlideToChat(
  joinCode: string,
  participantToken: string
): Promise<void> {
  const headers = new Headers();
  if (participantToken) headers.set("X-Participant-Token", participantToken);
  await studentFetch(
    `/student/sessions/${encodeURIComponent(joinCode)}/slides/current/send-to-chat`,
    {
      method: "POST",
      headers
    }
  );
}

export async function sendStudentShareFrameToChat(joinCode: string, participantToken: string) {
  await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/screen-share/frame/chat`, {
    method: "POST",
    headers: participantToken ? { "X-Participant-Token": participantToken } : {}
  });
}

export async function submitStudentSignal(
  joinCode: string,
  participantToken: string,
  value: SignalValue,
  slideIdx: number
): Promise<SignalAggregate> {
  const authenticated = Boolean(getStoredAuth());
  const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/signals`, {
    method: "POST",
    body: JSON.stringify(
      authenticated ? { value, slideIdx } : { participantToken, value, slideIdx }
    )
  });
  return res.json() as Promise<SignalAggregate>;
}

export async function updateStudentQuestion(
  courseId: string,
  sessionId: string,
  questionId: string,
  request: UpdateStudentQuestionRequest
): Promise<StudentQuestion> {
  const response = await apiFetch(
    `/courses/${courseId}/sessions/${sessionId}/questions/${questionId}`,
    {
      method: "PUT",
      body: JSON.stringify(request)
    }
  );
  return response.json() as Promise<StudentQuestion>;
}

export async function askStudentQuestion(
  joinCode: string,
  participantToken: string,
  text: string,
  anonymous = false
): Promise<StudentQuestion> {
  const authenticated = Boolean(getStoredAuth());
  const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/questions`, {
    method: "POST",
    body: JSON.stringify(
      authenticated ? { text, anonymous } : { participantToken, text, anonymous }
    )
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

export async function getSessionQuestionsPage(
  courseId: string,
  sessionId: string,
  status: StudentQuestionStatus = "OPEN",
  limit = 50,
  offset = 0
): Promise<SessionQuestionPage> {
  const params = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/questions?${params}`);
  return res.json() as Promise<SessionQuestionPage>;
}

export function connectStudentSession(
  joinCode: string,
  participantToken: string,
  onSnapshot: (snapshot: StudentSessionSnapshot) => void,
  onStateChange: (state: StudentConnectionState) => void
): StudentConnectionControls {
  const eventUrl = participantToken
    ? `/api/v1/student/sessions/${encodeURIComponent(joinCode)}/events?${new URLSearchParams({ participantToken })}`
    : `/api/v1/student/sessions/${encodeURIComponent(joinCode)}/events/public`;
  let source: EventSource | null = null;
  let reconnectTimer: number | undefined;
  let pollingTimer: number | undefined;
  let failures = 0;
  let stopped = false;
  let ended = false;
  let state: StudentConnectionState = "CONNECTING";
  const snapshotGate = new StudentSnapshotGate<StudentSessionSnapshot>();

  const updateState = (next: StudentConnectionState) => {
    if (state === next) return;
    state = next;
    onStateChange(next);
  };

  const stopPolling = () => {
    if (pollingTimer) window.clearInterval(pollingTimer);
    pollingTimer = undefined;
    pollingGeneration += 1;
  };

  let pollingGeneration = 0;
  const acceptSnapshot = (snapshot: StudentSessionSnapshot, requestGeneration?: number) => {
    if (stopped) return false;
    const accepted =
      requestGeneration === undefined
        ? snapshotGate.accept(snapshot)
        : snapshotGate.acceptRequest(snapshot, requestGeneration);
    if (!accepted) return false;
    onSnapshot(snapshot);
    if (snapshot.status !== "ENDED" && snapshot.status !== "ARCHIVED") return true;
    ended = true;
    source?.close();
    source = null;
    stopPolling();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    updateState("ENDED");
    return true;
  };

  const pollSnapshot = async (requestGeneration: number) => {
    if (stopped || ended || !navigator.onLine) return;
    const snapshotGeneration = snapshotGate.generation;
    try {
      const snapshot = participantToken
        ? await getStudentSession(joinCode, participantToken)
        : await getPublicStudentSession(joinCode);
      if (requestGeneration !== pollingGeneration || source?.readyState === EventSource.OPEN)
        return;
      acceptSnapshot(snapshot, snapshotGeneration);
      if (!ended && source?.readyState !== EventSource.OPEN) updateState("POLLING");
    } catch {
      if (stopped || requestGeneration !== pollingGeneration) return;
      updateState(navigator.onLine ? "RECONNECTING" : "OFFLINE");
    }
  };

  const startPolling = () => {
    if (stopped || ended || pollingTimer) return;
    const requestGeneration = ++pollingGeneration;
    updateState(navigator.onLine ? "POLLING" : "OFFLINE");
    void pollSnapshot(requestGeneration);
    pollingTimer = window.setInterval(() => void pollSnapshot(requestGeneration), 3000);
  };

  const scheduleReconnect = (delay: number) => {
    if (stopped || ended) return;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(openStream, delay);
  };

  function openStream() {
    if (stopped || ended) return;
    if (!navigator.onLine) {
      updateState("OFFLINE");
      startPolling();
      return;
    }

    source?.close();
    const nextSource = new EventSource(eventUrl);
    source = nextSource;
    if (!pollingTimer) updateState(failures > 0 ? "RECONNECTING" : "CONNECTING");
    nextSource.onopen = () => {
      if (stopped || source !== nextSource) return;
      failures = 0;
      stopPolling();
      updateState("CONNECTED");
    };
    nextSource.addEventListener("snapshot", (event) => {
      if (stopped || source !== nextSource) return;
      try {
        acceptSnapshot(JSON.parse((event as MessageEvent).data) as StudentSessionSnapshot);
      } catch {
        // A malformed event is ignored; the next snapshot or polling pass restores state.
      }
    });
    nextSource.addEventListener("question-answer", (event) => {
      if (stopped || source !== nextSource) return;
      try {
        const answer = JSON.parse((event as MessageEvent).data) as StudentQuestionAnswer;
        const latestSnapshot = snapshotGate.current;
        if (!latestSnapshot) return;
        const questionAnswers = latestSnapshot.questionAnswers.filter(
          (current) => current.questionId !== answer.questionId
        );
        acceptSnapshot({ ...latestSnapshot, questionAnswers: [...questionAnswers, answer] });
      } catch {
        // Polling restores a missed or malformed personalized answer.
      }
    });
    nextSource.onerror = () => {
      if (stopped || source !== nextSource) return;
      nextSource.close();
      source = null;
      failures += 1;
      if (failures >= 3) {
        startPolling();
      } else {
        updateState(navigator.onLine ? "RECONNECTING" : "OFFLINE");
      }
      scheduleReconnect(failures >= 3 ? 15000 : Math.min(1000 * 2 ** (failures - 1), 5000));
    };
  }

  const reconnect = () => {
    if (stopped || ended) return;
    failures = 0;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    void pollSnapshot(pollingGeneration);
    openStream();
  };
  const handleOnline = () => reconnect();
  const handleOffline = () => {
    source?.close();
    source = null;
    updateState("OFFLINE");
    startPolling();
  };
  const handleVisibility = () => {
    if (document.visibilityState === "visible") reconnect();
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pageshow", handleVisibility);
  window.addEventListener("focus", handleVisibility);
  onStateChange("CONNECTING");
  openStream();

  return {
    reconnect,
    disconnect: () => {
      stopped = true;
      source?.close();
      stopPolling();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    }
  };
}
