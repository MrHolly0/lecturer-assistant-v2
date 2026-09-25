import type { components } from "./schema";
import { expireStoredAuth, getStoredAuth } from "../auth";
import { apiFetch } from "./http";
import { refreshAuthSession } from "./refresh";

export type LiveSession = components["schemas"]["LiveSession"];
export type SessionParticipant = components["schemas"]["SessionParticipant"];
export type LectureSummary = components["schemas"]["LectureSummary"];
export type SessionHistoryItem = components["schemas"]["SessionHistoryItem"];
export type SessionHistoryPage = components["schemas"]["SessionHistoryPage"];
export type LiveSessionMessage = { type: string; session: LiveSession };

export interface ActiveSession {
  sessionId: string;
  courseId: string;
  joinCode: string;
  lectureTitle: string;
  currentSlideIdx: number;
}

export async function getMyActiveSession(): Promise<ActiveSession | null> {
  const response = await apiFetch("/me/active-session");
  if (response.status === 204) return null;
  return response.json() as Promise<ActiveSession>;
}

export async function startLiveSession(courseId: string, lectureId: string): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/lectures/${lectureId}/sessions`, {
    method: "POST"
  });
  return res.json() as Promise<LiveSession>;
}

export async function getLiveSession(courseId: string, sessionId: string): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}`);
  return res.json() as Promise<LiveSession>;
}

export async function listSessionParticipants(
  courseId: string,
  sessionId: string
): Promise<SessionParticipant[]> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/participants`);
  return res.json() as Promise<SessionParticipant[]>;
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
  offset = 0
): Promise<SessionHistoryPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
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
  slideIdx: number
): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/slide`, {
    method: "PUT",
    body: JSON.stringify({ slideIdx })
  });
  return res.json() as Promise<LiveSession>;
}

export async function saveLiveSessionAnnotations(
  courseId: string,
  sessionId: string,
  annotations: Record<string, unknown>
): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/annotations`, {
    method: "PUT",
    body: JSON.stringify({ annotations })
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

export async function endLiveSession(courseId: string, sessionId: string): Promise<LiveSession> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/end`, { method: "POST" });
  return res.json() as Promise<LiveSession>;
}

export function connectLiveSession(
  sessionId: string,
  onMessage: (message: LiveSessionMessage) => void
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

  function connect() {
    if (stopped) return;
    let buffer = "";
    let connectionToken = "";
    let connectedTimer: number | undefined;
    const currentSocket = new WebSocket(url);
    socket = currentSocket;

    currentSocket.addEventListener("open", () => {
      connectionToken = getStoredAuth()?.accessToken ?? "";
      currentSocket.send(
        `CONNECT\naccept-version:1.2\nAuthorization:Bearer ${connectionToken}\n\n\u0000`
      );
      connectedTimer = window.setTimeout(() => {
        void recoverAuthentication(connectionToken, currentSocket);
      }, 4000);
    });

    currentSocket.addEventListener("message", (event) => {
      buffer += String(event.data);
      const frames = buffer.split("\u0000");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const stompFrame = frame.replace(/^\n+/, "");
        const command = stompFrame.split("\n", 1)[0]?.trim();
        if (command === "CONNECTED") {
          if (connectedTimer) window.clearTimeout(connectedTimer);
          connectedTimer = undefined;
          attempt = 0;
          rejectedToken = null;
          refreshAttemptedSinceConnected = false;
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

    currentSocket.addEventListener("close", () => {
      if (connectedTimer) window.clearTimeout(connectedTimer);
      connectedTimer = undefined;
      if (socket === currentSocket) socket = null;
      scheduleReconnect();
    });
    currentSocket.addEventListener("error", () => currentSocket.close());
  }

  function scheduleReconnect() {
    if (stopped) return;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    const delay = reconnectImmediately ? 0 : Math.min(500 * 2 ** attempt, 5000);
    reconnectImmediately = false;
    if (delay > 0) attempt += 1;
    reconnectTimer = window.setTimeout(connect, delay);
  }

  async function recoverAuthentication(token: string, currentSocket: WebSocket) {
    if (stopped || currentSocket.readyState >= WebSocket.CLOSING) return;
    if (refreshAttemptedSinceConnected || rejectedToken === token) {
      currentSocket.close();
      return;
    }

    refreshAttemptedSinceConnected = true;
    rejectedToken = token;
    const refreshed = await refreshAuthSession();
    if (!refreshed) {
      expireStoredAuth();
      stopped = true;
      currentSocket.close();
    }
  }

  const handleAuthRefreshed = () => {
    if (stopped) return;
    reconnectImmediately = true;
    attempt = 0;
    refreshAttemptedSinceConnected = true;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    else scheduleReconnect();
  };

  window.addEventListener("auth:refreshed", handleAuthRefreshed);

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    window.removeEventListener("auth:refreshed", handleAuthRefreshed);
    socket?.close();
  };
}
