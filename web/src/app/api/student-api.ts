import type { components } from "./schema";
import { getStoredAuth } from "../auth";
import { apiErrorFromResponse } from "./errors";
import { apiFetch, withRequestDeadline } from "./http";
import { isRetryableError, retryDelayMs } from "./retry";
import { StudentSnapshotGate } from "./student-snapshot-gate";
import { newOperationKey } from "./operation-key";

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

export function studentParticipantHeaders(participantToken?: string): Record<string, string> {
  return !getStoredAuth() && participantToken ? { "X-Participant-Token": participantToken } : {};
}

export async function acknowledgeStudentDelivery(
  joinCode: string,
  participantToken: string,
  sessionId: string,
  completed: boolean,
  signal: AbortSignal,
  personId?: string
): Promise<void> {
  // Authenticated windows keep working when another device rotates the SSE token.
  // The captured personId prevents a delayed request from acknowledging for a different login.
  const receiptFetch = personId ? apiFetch : publicFetch;
  await withRequestDeadline(
    (deadline) =>
      receiptFetch(`/student/sessions/${encodeURIComponent(joinCode)}/delivery-receipt`, {
        method: "POST",
        headers: personId ? {} : { "X-Participant-Token": participantToken },
        body: JSON.stringify({ sessionId, completed, personId }),
        signal: deadline,
        keepalive: completed
      }),
    signal,
    8000
  );
}

export async function getMyStudentActiveSession(): Promise<StudentActiveSessionSummary | null> {
  const response = await apiFetch("/me/student-active-session");
  if (response.status === 204) return null;
  return response.json() as Promise<StudentActiveSessionSummary>;
}

export async function getStudentSession(
  joinCode: string,
  participantToken = "",
  signal?: AbortSignal
): Promise<StudentSessionSnapshot> {
  const headers = new Headers();
  if (!getStoredAuth() && participantToken) {
    headers.set("X-Participant-Token", participantToken);
  }
  return withRequestDeadline(async (requestSignal) => {
    const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}`, {
      headers,
      signal: requestSignal
    });
    return res.json() as Promise<StudentSessionSnapshot>;
  }, signal);
}

export async function getPublicStudentSession(
  joinCode: string,
  signal?: AbortSignal
): Promise<StudentSessionSnapshot> {
  return withRequestDeadline(async (requestSignal) => {
    const res = await publicFetch(`/student/sessions/${encodeURIComponent(joinCode)}`, {
      signal: requestSignal
    });
    return res.json() as Promise<StudentSessionSnapshot>;
  }, signal);
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
    headers: studentParticipantHeaders(participantToken),
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
    headers: studentParticipantHeaders(participantToken),
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
    headers: studentParticipantHeaders(participantToken),
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
  anonymous = false,
  operationKey = newOperationKey()
): Promise<StudentQuestion> {
  const authenticated = Boolean(getStoredAuth());
  const res = await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/questions`, {
    method: "POST",
    headers: { ...studentParticipantHeaders(participantToken), "Idempotency-Key": operationKey },
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
  offset = 0,
  query = "",
  signal?: AbortSignal
): Promise<SessionQuestionPage> {
  const params = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
  if (query.trim()) params.set("q", query.trim());
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/questions?${params}`, {
    signal
  });
  return res.json() as Promise<SessionQuestionPage>;
}

export function connectStudentSession(
  joinCode: string,
  participantToken: string,
  onSnapshot: (snapshot: StudentSessionSnapshot) => void,
  onStateChange: (state: StudentConnectionState) => void,
  readSnapshot?: (signal: AbortSignal) => Promise<StudentSessionSnapshot>,
  onDelivery?: (snapshot: StudentSessionSnapshot) => void
): StudentConnectionControls {
  const eventUrl = participantToken
    ? `/api/v1/student/sessions/${encodeURIComponent(joinCode)}/events?${new URLSearchParams({ participantToken })}`
    : `/api/v1/student/sessions/${encodeURIComponent(joinCode)}/events/public`;
  let source: EventSource | null = null;
  let reconnectTimer: number | undefined;
  let pollingTimer: number | undefined;
  let stableTimer: number | undefined;
  let handshakeTimer: number | undefined;
  let resumeTimer: number | undefined;
  let lastResumeAt = 0;
  let failures = 0;
  let pollFailures = 0;
  let pollNotBefore = 0;
  let pollingActive = false;
  let pollingGeneration = 0;
  let pollInFlight: Promise<void> | null = null;
  let pollAbort: AbortController | null = null;
  let stopped = false;
  let ended = false;
  let state: StudentConnectionState = "CONNECTING";
  const snapshotGate = new StudentSnapshotGate<StudentSessionSnapshot>();

  const updateState = (next: StudentConnectionState) => {
    if (state === next) return;
    state = next;
    onStateChange(next);
  };

  const clearStreamTimers = () => {
    if (stableTimer !== undefined) window.clearTimeout(stableTimer);
    if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer);
    stableTimer = undefined;
    handshakeTimer = undefined;
  };

  const stopPolling = () => {
    pollingActive = false;
    if (pollingTimer !== undefined) window.clearTimeout(pollingTimer);
    pollingTimer = undefined;
    pollingGeneration += 1;
    pollAbort?.abort();
  };

  const acceptSnapshot = (snapshot: StudentSessionSnapshot, requestGeneration?: number) => {
    if (stopped) return false;
    const accepted =
      requestGeneration === undefined
        ? snapshotGate.accept(snapshot)
        : snapshotGate.acceptRequest(snapshot, requestGeneration);
    if (!accepted) return false;
    onDelivery?.(snapshot);
    onSnapshot(snapshot);
    if (snapshot.status !== "ENDED" && snapshot.status !== "ARCHIVED") return true;
    ended = true;
    source?.close();
    source = null;
    clearStreamTimers();
    stopPolling();
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    updateState("ENDED");
    return true;
  };

  const schedulePoll = (delay: number) => {
    if (stopped || ended || !pollingActive || !navigator.onLine) return;
    if (pollingTimer !== undefined) window.clearTimeout(pollingTimer);
    pollingTimer = window.setTimeout(
      () => {
        pollingTimer = undefined;
        void pollSnapshot();
      },
      Math.max(delay, pollNotBefore - Date.now())
    );
  };

  function pollSnapshot(): Promise<void> {
    if (pollInFlight) return pollInFlight;
    if (stopped || ended || !navigator.onLine || !pollingActive) return Promise.resolve();
    const requestGeneration = pollingGeneration;
    const snapshotGeneration = snapshotGate.generation;
    const controller = new AbortController();
    pollAbort = controller;
    let nextDelay = 3000 + Math.floor(Math.random() * 1500);
    const request = async () => {
      try {
        const snapshot = await (readSnapshot
          ? withRequestDeadline(readSnapshot, controller.signal)
          : participantToken
            ? getStudentSession(joinCode, participantToken, controller.signal)
            : getPublicStudentSession(joinCode, controller.signal));
        if (
          controller.signal.aborted ||
          requestGeneration !== pollingGeneration ||
          source?.readyState === EventSource.OPEN
        )
          return;
        pollFailures = 0;
        pollNotBefore = 0;
        acceptSnapshot(snapshot, snapshotGeneration);
        if (!ended && source?.readyState !== EventSource.OPEN) updateState("POLLING");
      } catch (error) {
        if (stopped || controller.signal.aborted || requestGeneration !== pollingGeneration) return;
        updateState(navigator.onLine ? "RECONNECTING" : "OFFLINE");
        pollFailures += 1;
        nextDelay = retryDelayMs(pollFailures - 1, {
          baseMs: 6000,
          maxMs: 60000,
          error
        });
        pollNotBefore = Date.now() + nextDelay;
        // An authorization/validation rejection needs a new connection or user
        // action. Do not keep hammering the same invalid request every few seconds.
        if (!isRetryableError(error)) pollingActive = false;
      } finally {
        if (pollAbort === controller) pollAbort = null;
        pollInFlight = null;
        if (pollingActive) schedulePoll(nextDelay);
      }
    };
    pollInFlight = request();
    return pollInFlight;
  }

  const startPolling = () => {
    if (stopped || ended || pollingActive || !navigator.onLine) return;
    pollingActive = true;
    pollingGeneration += 1;
    updateState("RECONNECTING");
    // Spread the transition of an entire class from SSE to HTTP as well.
    schedulePoll(retryDelayMs(0, { baseMs: 1000, maxMs: 1000 }));
  };

  const scheduleReconnect = () => {
    if (stopped || ended || !navigator.onLine || reconnectTimer !== undefined) return;
    reconnectTimer = window.setTimeout(
      () => {
        reconnectTimer = undefined;
        openStream();
      },
      retryDelayMs(Math.max(0, failures - 1), { baseMs: 1000, maxMs: 30000 })
    );
  };

  function streamFailed(nextSource: EventSource | null) {
    if (stopped || ended || source !== nextSource) return;
    nextSource?.close();
    source = null;
    clearStreamTimers();
    failures += 1;
    if (failures >= 3) startPolling();
    else updateState(navigator.onLine ? "RECONNECTING" : "OFFLINE");
    scheduleReconnect();
  }

  function openStream() {
    if (stopped || ended) return;
    if (!navigator.onLine) {
      updateState("OFFLINE");
      return;
    }
    // Focus/pageshow/visibility often arrive together. Neither an open stream nor
    // a handshake already in progress should be replaced by that event burst.
    if (source && source.readyState !== EventSource.CLOSED) return;
    source = null;
    if (!pollingActive) updateState(failures > 0 ? "RECONNECTING" : "CONNECTING");
    let nextSource: EventSource;
    try {
      nextSource = new EventSource(eventUrl);
    } catch {
      streamFailed(null);
      return;
    }
    source = nextSource;
    handshakeTimer = window.setTimeout(() => streamFailed(nextSource), 12000);
    nextSource.onopen = () => {
      if (stopped || source !== nextSource) return;
      if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer);
      handshakeTimer = undefined;
      // An open/error loop is still an unhealthy transport. Reset its backoff
      // only after a stable connection, rather than on each TCP handshake.
      stableTimer = window.setTimeout(() => {
        stableTimer = undefined;
        if (!stopped && source === nextSource && nextSource.readyState === EventSource.OPEN)
          failures = 0;
      }, 10000);
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
    nextSource.addEventListener("keepalive", () => {
      if (stopped || source !== nextSource || !snapshotGate.current) return;
      onDelivery?.(snapshotGate.current);
    });
    nextSource.onerror = () => streamFailed(nextSource);
  }

  const reconnect = () => {
    if (stopped || ended || !navigator.onLine) return;
    if (source && source.readyState !== EventSource.CLOSED) return;
    if (reconnectTimer !== undefined) return;
    if (failures >= 3) startPolling();
    // Even an online/resume burst preserves accumulated failure backoff.
    scheduleReconnect();
  };
  const handleOnline = () => reconnect();
  const handleOffline = () => {
    source?.close();
    source = null;
    clearStreamTimers();
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    stopPolling();
    updateState("OFFLINE");
  };
  const handleVisibility = () => {
    if (
      stopped ||
      ended ||
      document.visibilityState !== "visible" ||
      resumeTimer !== undefined ||
      Date.now() - lastResumeAt < 1000
    )
      return;
    resumeTimer = window.setTimeout(() => {
      resumeTimer = undefined;
      lastResumeAt = Date.now();
      if (document.visibilityState === "visible") reconnect();
    }, 0);
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
      source = null;
      clearStreamTimers();
      stopPolling();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    }
  };
}
