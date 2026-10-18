import test from "node:test";
import assert from "node:assert/strict";
import { pollAnalytics, signalShare } from "./sessionAnalytics.ts";
const poll = (votes, correctOptionIdx, status = "CLOSED") => ({
  pollId: "test",
  questionText: "Проверка",
  options: votes.map((_, i) => `Вариант ${i}`),
  votes,
  correctOptionIdx,
  totalResponses: votes.reduce((a, b) => a + b, 0),
  status,
  startedAt: "2026-10-18T00:00:00Z"
});
test("weights correct answers by response count, not average poll percentage", () => {
  const result = pollAnalytics([poll([1, 0], 0), poll([0, 9], 0)]);
  assert.equal(result.correctPercent, 10);
  assert.equal(result.correctAnswers, 1);
  assert.equal(result.gradedAnswers, 10);
  assert.equal(result.incorrectAnswers, 9);
});
test("ungraded and open polls do not count as incorrect answers", () => {
  const result = pollAnalytics([poll([2, 0], 0), poll([0, 8], null), poll([0, 3], 0, "OPEN")]);
  assert.equal(result.correctPercent, 100);
  assert.equal(result.gradedAnswers, 2);
  assert.equal(result.totalAnswers, 13);
  assert.equal(result.ungradedAnswers, 11);
  assert.equal(result.incorrectAnswers, 0);
});
test("no responses is absence of a score, not zero percent", () => {
  assert.equal(pollAnalytics([poll([0, 0], 0)]).correctPercent, null);
  assert.equal(pollAnalytics([]).correctPercent, null);
});
test("measured zero correct answers remains zero percent", () => {
  assert.equal(pollAnalytics([poll([0, 4], 0)]).correctPercent, 0);
});
test("legacy invalid correct indices are not graded", () => {
  for (const index of [-1, 2, 0.5, null, undefined]) {
    const result = pollAnalytics([poll([1, 3], index)]);
    assert.equal(result.gradedAnswers, 0);
    assert.equal(result.ungradedAnswers, 4);
    assert.equal(result.correctPercent, null);
  }
});
test("a valid unanswered graded poll does not distort weighted rate", () => {
  const result = pollAnalytics([poll([0, 0], 1), poll([2, 2], 0)]);
  assert.equal(result.gradedPollCount, 2);
  assert.equal(result.correctPercent, 50);
});
test("signal share keeps zero distinct from no observations and bounds the percentage", () => {
  assert.equal(signalShare(0, 0), null);
  assert.equal(signalShare(0, 5), 0);
  assert.equal(signalShare(1, 3), 33);
  assert.equal(signalShare(6, 5), 100);
  assert.equal(signalShare(-1, 5), 0);
});
