import type { LectureSummary } from "../../app/api/live-api";

type SummaryPoll = LectureSummary["pollResults"][number];

export interface PollAnalytics {
  correctAnswers: number;
  incorrectAnswers: number;
  gradedAnswers: number;
  totalAnswers: number;
  ungradedAnswers: number;
  gradedPollCount: number;
  correctPercent: number | null;
}

/** Weight by responses, never by the number of polls. An ungraded poll is not a failed one. */
export function pollAnalytics(polls: readonly SummaryPoll[]): PollAnalytics {
  let correctAnswers = 0;
  let gradedAnswers = 0;
  let totalAnswers = 0;
  let gradedPollCount = 0;
  for (const poll of polls) {
    const responses = Math.max(0, poll.totalResponses);
    totalAnswers += responses;
    const correct = poll.correctOptionIdx;
    if (
      poll.status !== "CLOSED" ||
      correct === null ||
      correct === undefined ||
      !Number.isInteger(correct) ||
      correct < 0 ||
      correct >= poll.options.length
    ) {
      continue;
    }
    gradedPollCount += 1;
    gradedAnswers += responses;
    correctAnswers += Math.min(responses, Math.max(0, poll.votes[correct] ?? 0));
  }
  return {
    correctAnswers,
    incorrectAnswers: gradedAnswers - correctAnswers,
    gradedAnswers,
    totalAnswers,
    ungradedAnswers: totalAnswers - gradedAnswers,
    gradedPollCount,
    correctPercent: signalShare(correctAnswers, gradedAnswers)
  };
}

/** Percent of recorded signals/answers. Null means no denominator, not a measured zero. */
export function signalShare(value: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((Math.min(total, Math.max(0, value)) / total) * 100);
}
