import type { components } from "./schema";
import { getStoredAuth } from "../auth";
import { apiFetch } from "./http";
import { studentFetch } from "./student-api";

export type PollStatus = components["schemas"]["PollStatus"];
export type QuickPoll = components["schemas"]["QuickPoll"];
export type PollResult = components["schemas"]["PollResult"];
export type ActivePollView = components["schemas"]["ActivePollView"];
export type StartPollRequest = components["schemas"]["StartPollRequest"];
export type ClosePollRequest = components["schemas"]["ClosePollRequest"];

export type QuestionType = components["schemas"]["QuestionType"];
export type QuestionOption = components["schemas"]["QuestionOption"];
export type QuestionBankEntry = components["schemas"]["QuestionBankEntry"];
export type CreateQuestionRequest = components["schemas"]["CreateQuestionRequest"];

export async function startPoll(
  courseId: string,
  sessionId: string,
  request: StartPollRequest
): Promise<PollResult> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/polls`, {
    method: "POST",
    body: JSON.stringify(request)
  });
  return res.json() as Promise<PollResult>;
}

export async function getActivePoll(
  courseId: string,
  sessionId: string
): Promise<PollResult | null> {
  try {
    const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/polls/active`);
    return res.json() as Promise<PollResult>;
  } catch {
    return null;
  }
}

export async function closePoll(
  courseId: string,
  sessionId: string,
  pollId: string,
  correctOptionIdx?: number
): Promise<PollResult> {
  const res = await apiFetch(
    `/courses/${courseId}/sessions/${sessionId}/polls/${pollId}/close`,
    {
      method: "POST",
      body: JSON.stringify({ correctOptionIdx })
    }
  );
  return res.json() as Promise<PollResult>;
}

export async function listQuestions(courseId: string, tag?: string): Promise<QuestionBankEntry[]> {
  const params = tag ? `?tag=${encodeURIComponent(tag)}` : "";
  const res = await apiFetch(`/courses/${courseId}/questions${params}`);
  return res.json() as Promise<QuestionBankEntry[]>;
}

export async function createQuestion(
  courseId: string,
  request: CreateQuestionRequest
): Promise<QuestionBankEntry> {
  const res = await apiFetch(`/courses/${courseId}/questions`, {
    method: "POST",
    body: JSON.stringify(request)
  });
  return res.json() as Promise<QuestionBankEntry>;
}

export async function updateQuestion(
  courseId: string,
  questionId: string,
  request: CreateQuestionRequest
): Promise<QuestionBankEntry> {
  const res = await apiFetch(`/courses/${courseId}/questions/${questionId}`, {
    method: "PUT",
    body: JSON.stringify(request)
  });
  return res.json() as Promise<QuestionBankEntry>;
}

export async function archiveQuestion(courseId: string, questionId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/questions/${questionId}`, { method: "DELETE" });
}

export async function respondToPoll(
  joinCode: string,
  pollId: string,
  participantToken: string,
  optionIdx: number
): Promise<void> {
  const authenticated = Boolean(getStoredAuth());
  await studentFetch(`/student/sessions/${encodeURIComponent(joinCode)}/polls/${pollId}/respond`, {
    method: "POST",
    body: JSON.stringify(authenticated ? { optionIdx } : { participantToken, optionIdx })
  });
}
