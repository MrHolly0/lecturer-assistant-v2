import type { components } from "./schema";
import { newOperationKey } from "./operation-key";
import { getStoredAuth } from "../auth";
import { ApiError } from "./errors";
import { apiFetch } from "./http";
import { studentFetch, studentParticipantHeaders } from "./student-api";

export type PollStatus = components["schemas"]["PollStatus"];
export type QuickPoll = components["schemas"]["QuickPoll"];
export type PollResult = components["schemas"]["PollResult"];
export type ClosedPollPage = components["schemas"]["ClosedPollPage"];
export type ActivePollView = components["schemas"]["ActivePollView"];
export type StartPollRequest = components["schemas"]["StartPollRequest"];
export type StartBankPollRequest = components["schemas"]["StartBankPollRequest"];
export type ClosePollRequest = components["schemas"]["ClosePollRequest"];
export type PollVote = components["schemas"]["PollVote"];

export type QuestionType = components["schemas"]["QuestionType"];
export type QuestionOption = components["schemas"]["QuestionOption"];
export type QuestionBankEntry = components["schemas"]["QuestionBankEntry"];
export type CreateQuestionRequest = components["schemas"]["CreateQuestionRequest"];

export async function startPoll(
  courseId: string,
  sessionId: string,
  request: StartPollRequest,
  key = newOperationKey()
): Promise<PollResult> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/polls`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(request)
  });
  return res.json() as Promise<PollResult>;
}

export async function startPollFromBank(
  courseId: string,
  sessionId: string,
  request: StartBankPollRequest,
  key = newOperationKey()
): Promise<PollResult> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/polls/from-bank`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
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
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function listClosedPolls(
  courseId: string,
  sessionId: string,
  limit = 20,
  offset = 0
): Promise<ClosedPollPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await apiFetch(
    `/courses/${courseId}/sessions/${sessionId}/polls?${params.toString()}`
  );
  return res.json() as Promise<ClosedPollPage>;
}

export async function closePoll(
  courseId: string,
  sessionId: string,
  pollId: string,
  correctOptionIdx?: number | null
): Promise<PollResult> {
  const res = await apiFetch(`/courses/${courseId}/sessions/${sessionId}/polls/${pollId}/close`, {
    method: "POST",
    body: JSON.stringify({ correctOptionIdx })
  });
  return res.json() as Promise<PollResult>;
}

export async function setPollCorrectOption(
  courseId: string,
  sessionId: string,
  pollId: string,
  correctOptionIdx: number | null
): Promise<PollResult> {
  const res = await apiFetch(
    `/courses/${courseId}/sessions/${sessionId}/polls/${pollId}/correct-option`,
    {
      method: "PUT",
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
  request: CreateQuestionRequest,
  operationKey = newOperationKey()
): Promise<QuestionBankEntry> {
  const res = await apiFetch(`/courses/${courseId}/questions`, {
    method: "POST",
    headers: { "Idempotency-Key": operationKey },
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

export async function linkQuestionLecture(
  courseId: string,
  questionId: string,
  lectureId: string
): Promise<QuestionBankEntry> {
  const res = await apiFetch(`/courses/${courseId}/questions/${questionId}/lectures/${lectureId}`, {
    method: "PUT"
  });
  return res.json() as Promise<QuestionBankEntry>;
}

export async function unlinkQuestionLecture(
  courseId: string,
  questionId: string,
  lectureId: string
): Promise<void> {
  await apiFetch(`/courses/${courseId}/questions/${questionId}/lectures/${lectureId}`, {
    method: "DELETE"
  });
}

export async function archiveQuestion(courseId: string, questionId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/questions/${questionId}`, { method: "DELETE" });
}

export async function respondToPoll(
  joinCode: string,
  pollId: string,
  participantToken: string,
  answer: number | string
): Promise<PollVote> {
  const authenticated = Boolean(getStoredAuth());
  const res = await studentFetch(
    `/student/sessions/${encodeURIComponent(joinCode)}/polls/${pollId}/respond`,
    {
      method: "POST",
      headers: studentParticipantHeaders(participantToken),
      body: JSON.stringify({
        ...(authenticated ? {} : { participantToken }),
        ...(typeof answer === "string" ? { textAnswer: answer } : { optionIdx: answer })
      })
    }
  );
  return res.json() as Promise<PollVote>;
}

export async function listTextPollResponses(
  courseId: string,
  sessionId: string,
  pollId: string,
  offset = 0
) {
  const response = await apiFetch(
    `/courses/${courseId}/sessions/${sessionId}/polls/${pollId}/answers?limit=50&offset=${offset}`
  );
  return response.json() as Promise<components["schemas"]["TextPollResponsePage"]>;
}
