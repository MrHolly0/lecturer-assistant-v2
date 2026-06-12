import type { components } from "./schema";
import { getStoredAuth } from "../auth";
import { apiFetch } from "./http";

export type LiveSession = components["schemas"]["LiveSession"];
export type SessionParticipant = components["schemas"]["SessionParticipant"];
export type LiveSessionMessage = { type: string; session: LiveSession };

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

  function connect() {
    if (stopped) return;
    let buffer = "";
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      attempt = 0;
      const token = getStoredAuth()?.accessToken ?? "";
      socket?.send(`CONNECT\naccept-version:1.2\nAuthorization:Bearer ${token}\n\n\u0000`);
      socket?.send(`SUBSCRIBE\nid:session\ndestination:/topic/session/${sessionId}\n\n\u0000`);
    });

    socket.addEventListener("message", (event) => {
      buffer += String(event.data);
      const frames = buffer.split("\u0000");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const body = frame.slice(frame.indexOf("\n\n") + 2).trim();
        if (!body || body === "CONNECTED") continue;
        try {
          onMessage(JSON.parse(body) as LiveSessionMessage);
        } catch {
          // STOMP heartbeats and broker frames without JSON are ignored.
        }
      }
    });

    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => socket?.close());
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = Math.min(500 * 2 ** attempt, 5000);
    attempt += 1;
    reconnectTimer = window.setTimeout(connect, delay);
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    socket?.close();
  };
}
