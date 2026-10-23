import type { components } from "./schema";
import { expireStoredAuth, getStoredAuth } from "../auth";
import { apiFetch, withRequestDeadline } from "./http";
import { refreshAuthSession } from "./refresh";
import { retryDelayMs } from "./retry";
import { newOperationKey } from "./operation-key";

export type SessionGroupRef = components["schemas"]["SessionGroup"];
export type LiveSession = components["schemas"]["LiveSession"];
export type SessionParticipant = components["schemas"]["SessionParticipant"];
export type LectureSummary = components["schemas"]["LectureSummary"];
export type SessionHistoryItem = components["schemas"]["SessionHistoryItem"];
export type SessionHistoryPage = components["schemas"]["SessionHistoryPage"];
export type LiveSessionMessage =
  | { type: string; session: LiveSession }
  | { type: "session.invalidate"; sessionId: string; version: number; eventType: string };
export type LiveConnectionState =
  | "connecting"
  | "connected"
  | "polling"
  | "reconnecting"
  | "offline";
export type StartSessionRequest = components["schemas"]["StartSessionRequest"];
export type ActiveSession = components["schemas"]["ActiveSessionSummary"];

export async function getMyActiveSession(): Promise<ActiveSession | null> {
  const response = await apiFetch("/me/active-session");
  if (response.status === 204) return null;
  return response.json() as Promise<ActiveSession>;
}

export async function startLiveSession(
  courseId: string,
  lectureId: string,
  request: StartSessionRequest,
  operationKey = newOperationKey()
): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/lectures/${lectureId}/sessions`, {
    method: "POST",
    headers: { "Idempotency-Key": operationKey },
    body: JSON.stringify(request)
  });
  return res.json() as Promise<LiveSession>;
}

export async function getLiveSession(
  courseId: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<LiveSession> {
  return withRequestDeadline(async (requestSignal) => {
    const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}`, {
      signal: requestSignal
    });
    return res.json() as Promise<LiveSession>;
  }, signal);
}

export async function beginLiveSession(courseId: string, sessionId: string): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/begin`, {
    method: "POST"
  });
  return res.json() as Promise<LiveSession>;
}

export async function listSessionParticipants(
  courseId: string,
  sessionId: string
): Promise<SessionParticipant[]> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/participants`);
  return res.json() as Promise<SessionParticipant[]>;
}

export async function kickSessionParticipant(
  courseId: string,
  sessionId: string,
  personId: string
): Promise<SessionParticipant> {
  const res = await apiFetch(
    `/courses/${courseId}/sessions/${sessionId}/participants/${personId}/kick`,
    {
      method: "POST"
    }
  );
  return res.json() as Promise<SessionParticipant>;
}

export async function requestSessionParticipantName(
  courseId: string,
  sessionId: string,
  personId: string
): Promise<SessionParticipant> {
  const res = await apiFetch(
    `/courses/${courseId}/sessions/${sessionId}/participants/${personId}/request-name`,
    { method: "POST" }
  );
  return res.json() as Promise<SessionParticipant>;
}

export async function getLectureSummary(
  courseId: string,
  sessionId: string
): Promise<LectureSummary> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/summary`);
  return res.json() as Promise<LectureSummary>;
}

export async function listSessionHistory(
  courseId: string,
  limit = 20,
  offset = 0,
  filters: {
    query?: string;
    groupId?: string;
    endedFrom?: string;
    endedBefore?: string;
  } = {}
): Promise<SessionHistoryPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const res = await apiFetch(`/courses/${courseId}/sessions?${params.toString()}`);
  return res.json() as Promise<SessionHistoryPage>;
}

export async function joinLiveSession(courseId: string, joinCode: string): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/join`, {
    method: "POST",
    body: JSON.stringify({ joinCode })
  });
  return res.json() as Promise<LiveSession>;
}

export async function changeLiveSessionSlide(
  courseId: string,
  sessionId: string,
  slideIdx: number,
  expectedVersion?: number
): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/slide`, {
    method: "PUT",
    body: JSON.stringify({ slideIdx, expectedVersion })
  });
  return res.json() as Promise<LiveSession>;
}

export async function saveLiveSessionAnnotations(
  courseId: string,
  sessionId: string,
  annotations: Record<string, unknown>,
  expectedVersion?: number
): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/annotations`, {
    method: "PUT",
    body: JSON.stringify({ annotations, expectedVersion })
  });
  return res.json() as Promise<LiveSession>;
}

export async function pauseLiveSession(courseId: string, sessionId: string): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/pause`, {
    method: "POST"
  });
  return res.json() as Promise<LiveSession>;
}

export async function resumeLiveSession(courseId: string, sessionId: string): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/resume`, {
    method: "POST"
  });
  return res.json() as Promise<LiveSession>;
}

export async function setLiveProjectionCode(
  courseId: string,
  sessionId: string,
  showJoinCode: boolean
): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/projection`, {
    method: "PUT",
    body: JSON.stringify({ showJoinCode })
  });
  return res.json() as Promise<LiveSession>;
}

export async function endLiveSession(courseId: string, sessionId: string): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/end`, { method: "POST" });
  return res.json() as Promise<LiveSession>;
}

export function connectLiveSession(
  sessionId: string,
  onMessage: (message: LiveSessionMessage) => void,
  onStateChange?: (state: LiveConnectionState) => void
) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${protocol}://${window.location.host}/ws/session/${sessionId}`;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let stopped = false;
  let attempt = 0;
  let reconnectImmediately = false;
  let rejectedToken: string | null = null;
  let refreshAttemptedSinceConnected = false;
  let lastReceivedAt = 0;
  let receiveTimeout = 0;
  let heartbeatTimer: number | undefined;

  function clearHeartbeat() {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    receiveTimeout = 0;
  }

  function connect() {
    if (stopped) return;
    if (!navigator.onLine) {
      onStateChange?.("offline");
      scheduleReconnect();
      return;
    }
    onStateChange?.(attempt === 0 ? "connecting" : "reconnecting");
    let buffer = "";
    let connectionToken = "";
    let connectedTimer: number | undefined;
    let stableTimer: number | undefined;
    let currentSocket: WebSocket;
    try {
      currentSocket = new WebSocket(url);
    } catch {
      onStateChange?.("reconnecting");
      scheduleReconnect();
      return;
    }
    socket = currentSocket;
    // Includes TCP/TLS and the STOMP handshake, not only time after `open`.
    connectedTimer = window.setTimeout(() => currentSocket.close(), 10000);

    currentSocket.addEventListener("open", () => {
      if (stopped || socket !== currentSocket) return currentSocket.close();
      connectionToken = getStoredAuth()?.accessToken ?? "";
      currentSocket.send(
        `CONNECT\naccept-version:1.2\nhost:${window.location.host}\nheart-beat:10000,10000\nAuthorization:Bearer ${connectionToken}\n\n\u0000`
      );
    });

    currentSocket.addEventListener("message", (event) => {
      if (socket !== currentSocket || stopped) return;
      lastReceivedAt = Date.now();
      const data = String(event.data);
      if (!buffer && !data.trim()) return;
      buffer += data;
      const frames = buffer.split("\u0000");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const stompFrame = frame.replace(/^\n+/, "");
        const command = stompFrame.split("\n", 1)[0]?.trim();
        if (command === "CONNECTED") {
          if (connectedTimer) window.clearTimeout(connectedTimer);
          connectedTimer = undefined;
          stableTimer = window.setTimeout(() => {
            if (stopped || socket !== currentSocket || currentSocket.readyState !== WebSocket.OPEN)
              return;
            attempt = 0;
            rejectedToken = null;
            refreshAttemptedSinceConnected = false;
          }, 10000);
          const heartbeat = stompFrame.match(/^heart-beat:(\d+),(\d+)\r?$/m);
          const serverSend = Number(heartbeat?.[1] ?? 0);
          const serverReceive = Number(heartbeat?.[2] ?? 0);
          clearHeartbeat();
          receiveTimeout = serverSend > 0 ? Math.max(45000, serverSend * 3) : 0;
          if (serverSend > 0 || serverReceive > 0) {
            heartbeatTimer = window.setInterval(
              () => {
                if (socket !== currentSocket || currentSocket.readyState !== WebSocket.OPEN) return;
                if (receiveTimeout && Date.now() - lastReceivedAt > receiveTimeout) {
                  currentSocket.close();
                } else if (serverReceive > 0) currentSocket.send("\n");
              },
              Math.max(10000, serverReceive)
            );
          }
          onStateChange?.("connected");
          currentSocket.send(
            `SUBSCRIBE\nid:session\ndestination:/topic/session/${sessionId}\n\n\u0000`
          );
          continue;
        }
        if (command === "ERROR") {
          void recoverAuthentication(connectionToken, currentSocket);
          continue;
        }
        if (command !== "MESSAGE") continue;

        const body = stompFrame.slice(stompFrame.indexOf("\n\n") + 2).trim();
        if (!body) continue;
        try {
          onMessage(JSON.parse(body) as LiveSessionMessage);
        } catch {
          // STOMP heartbeats and broker frames without JSON are ignored.
        }
      }
    });

    currentSocket.addEventListener("close", (event) => {
      if (connectedTimer) window.clearTimeout(connectedTimer);
      if (stableTimer) window.clearTimeout(stableTimer);
      connectedTimer = undefined;
      if (socket !== currentSocket) return;
      socket = null;
      clearHeartbeat();
      if (!stopped) onStateChange?.(navigator.onLine ? "reconnecting" : "offline");
      if (event.code === 1008 && !stopped)
        void recoverAuthentication(connectionToken, currentSocket);
      else scheduleReconnect();
    });
    currentSocket.addEventListener("error", () => currentSocket.close());
  }

  function scheduleReconnect() {
    if (stopped || !navigator.onLine) return;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    const delay = reconnectImmediately ? 0 : retryDelayMs(attempt, { baseMs: 500, maxMs: 30000 });
    reconnectImmediately = false;
    if (delay > 0) attempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  async function recoverAuthentication(token: string, currentSocket: WebSocket) {
    if (stopped) return;
    if (refreshAttemptedSinceConnected || rejectedToken === token) {
      currentSocket.close();
      if (socket === null) scheduleReconnect();
      return;
    }

    refreshAttemptedSinceConnected = true;
    rejectedToken = token;
    try {
      const refreshed = await refreshAuthSession();
      if (refreshed) return;
      if (getStoredAuth()?.accessToken === token) expireStoredAuth();
      stopped = true;
      currentSocket.close();
    } catch {
      // Network/5xx refresh failures do not revoke the access token. Reconnect
      // with backoff and allow another refresh attempt on the next socket.
      refreshAttemptedSinceConnected = false;
      rejectedToken = null;
      currentSocket.close();
      if (socket === null) scheduleReconnect();
    }
  }

  const handleAuthRefreshed = () => {
    if (stopped) return;
    reconnectImmediately = true;
    attempt = 0;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    else scheduleReconnect();
  };

  const handleOnline = () => {
    if (stopped) return;
    if (socket && socket.readyState < WebSocket.CLOSING) return;
    if (reconnectTimer === undefined) scheduleReconnect();
  };

  const handleOffline = () => {
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    onStateChange?.("offline");
    socket?.close();
  };
  let resumeTimer: number | undefined;
  const handleResume = () => {
    if (stopped || document.visibilityState !== "visible" || resumeTimer) return;
    // Preserve healthy connections on ordinary focus changes. A suspended window
    // reconnects only when its transport or negotiated heartbeat is stale.
    resumeTimer = window.setTimeout(() => {
      resumeTimer = undefined;
      if (stopped || document.visibilityState !== "visible") return;
      if (
        socket?.readyState === WebSocket.OPEN &&
        receiveTimeout > 0 &&
        Date.now() - lastReceivedAt > receiveTimeout
      )
        socket.close();
      else handleOnline();
    }, 0);
  };

  window.addEventListener("auth:refreshed", handleAuthRefreshed);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  window.addEventListener("pageshow", handleResume);
  window.addEventListener("focus", handleResume);
  document.addEventListener("visibilitychange", handleResume);

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (resumeTimer) window.clearTimeout(resumeTimer);
    clearHeartbeat();
    window.removeEventListener("auth:refreshed", handleAuthRefreshed);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("pageshow", handleResume);
    window.removeEventListener("focus", handleResume);
    document.removeEventListener("visibilitychange", handleResume);
    socket?.close();
  };
}
