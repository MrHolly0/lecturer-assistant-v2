import type { components } from "./schema";
import { getStoredAuth } from "../auth";
import { apiFetch, ApiError } from "./http";

type GeneratedStudentSessionSnapshot = components["schemas"]["StudentSessionSnapshot"];
type GeneratedActivePoll = components["schemas"]["ActivePollView"];

export type StudentActivePoll = Omit<GeneratedActivePoll, "correctOptionIdx" | "votes"> & {
  correctOptionIdx?: number | null;
  votes?: number[] | null;
};
export type StudentSessionSnapshot = Omit<GeneratedStudentSessionSnapshot, "activePoll"> & {
  activePoll?: StudentActivePoll | null;
  myVote?: number | null;
};
export type StudentJoinResponse = components["schemas"]["StudentJoinResponse"];
export type SignalAggregate = components["schemas"]["SignalAggregate"];
export type SignalValue = components["schemas"]["SignalValue"];
export type StudentQuestion = components["schemas"]["StudentQuestion"];
export type StudentEngagement = components["schemas"]["StudentEngagement"];
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
  onSnapshot: (snapshot: StudentSessionSnapshot) => void,
  onStateChange: (state: StudentConnectionState) => void
): StudentConnectionControls {
  const eventUrl = `/api/v1/student/sessions/${encodeURIComponent(joinCode)}/events?${new URLSearchParams({ participantToken })}`;
  let source: EventSource | null = null;
  let reconnectTimer: number | undefined;
  let pollingTimer: number | undefined;
  let failures = 0;
  let stopped = false;
  let ended = false;
  let state: StudentConnectionState = "CONNECTING";

  const updateState = (next: StudentConnectionState) => {
    if (state === next) return;
    state = next;
    onStateChange(next);
  };

  const stopPolling = () => {
    if (pollingTimer) window.clearInterval(pollingTimer);
    pollingTimer = undefined;
  };

  const acceptSnapshot = (snapshot: StudentSessionSnapshot) => {
    onSnapshot(snapshot);
    if (snapshot.status !== "ENDED" && snapshot.status !== "ARCHIVED") return;
    ended = true;
    source?.close();
    source = null;
    stopPolling();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    updateState("ENDED");
  };

  const pollSnapshot = async () => {
    if (stopped || ended || !navigator.onLine) return;
    try {
      const snapshot = await getStudentSession(joinCode, participantToken);
      acceptSnapshot(snapshot);
      if (!ended && source?.readyState !== EventSource.OPEN) updateState("POLLING");
    } catch {
      updateState(navigator.onLine ? "RECONNECTING" : "OFFLINE");
    }
  };

  const startPolling = () => {
    if (stopped || ended || pollingTimer) return;
    updateState(navigator.onLine ? "POLLING" : "OFFLINE");
    void pollSnapshot();
    pollingTimer = window.setInterval(pollSnapshot, 3000);
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
    source = new EventSource(eventUrl);
    if (!pollingTimer) updateState(failures > 0 ? "RECONNECTING" : "CONNECTING");
    source.onopen = () => {
      failures = 0;
      stopPolling();
      updateState("CONNECTED");
    };
    source.addEventListener("snapshot", (event) => {
      try {
        acceptSnapshot(JSON.parse((event as MessageEvent).data) as StudentSessionSnapshot);
      } catch {
        // A malformed event is ignored; the next snapshot or polling pass restores state.
      }
    });
    source.onerror = () => {
      source?.close();
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
    void pollSnapshot();
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
    }
  };
}
