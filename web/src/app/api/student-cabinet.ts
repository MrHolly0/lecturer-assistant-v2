import { apiFetch } from "./http";

export interface CabinetSession {
  sessionId: string;
  title: string;
  courseTitle: string;
  groups: string | null;
  joinCode: string | null;
  status: string;
  joined: boolean;
  startedAt: string | null;
  endedAt: string | null;
  joinedAt: string | null;
  leftAt: string | null;
}

export interface StudentCabinet {
  ongoing: CabinetSession[];
  moreOngoing: boolean;
  history: CabinetSession[];
  historyTotal: number;
  historyLimit: number;
  historyOffset: number;
}

export async function getStudentCabinet(offset = 0): Promise<StudentCabinet> {
  const response = await apiFetch(`/me/student-cabinet?limit=20&offset=${offset}`);
  return response.json() as Promise<StudentCabinet>;
}

export async function leaveStudentSession(code: string, token: string): Promise<void> {
  await apiFetch(`/student/sessions/${encodeURIComponent(code)}/leave`, {
    method: "POST",
    headers: token ? { "X-Participant-Token": token } : undefined
  });
}
