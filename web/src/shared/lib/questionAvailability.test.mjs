import test from 'node:test';
import assert from 'node:assert/strict';
import { questionAvailability } from './questionAvailability.ts';
const question = (questionType, count, correctCount = 1) => ({
  questionType,
  options: Array.from({ length: count }, (_, index) => ({ text: `Ответ ${index + 1}`, correct: index < correctCount }))
});
test('live checks accept exactly one correct answer within the server option boundaries', () => {
  for (const type of ['CHOICE', 'TRUE_FALSE']) {
    assert.equal(questionAvailability(question(type, 2)), null);
    assert.equal(questionAvailability(question(type, 6)), null);
    assert.ok(questionAvailability(question(type, 1)));
    assert.ok(questionAvailability(question(type, 7)));
    assert.ok(questionAvailability(question(type, 2, 0)));
    assert.ok(questionAvailability(question(type, 2, 2)));
  }
});
test('bank-only types stay unavailable even when their options resemble a supported poll', () => {
  for (const type of ['MULTIPLE_CHOICE']) {
    assert.ok(questionAvailability(question(type, 2)));
  }
});

test("free text can launch without predefined answers", () => {
  assert.equal(questionAvailability({ questionType: "SHORT_ANSWER", options: [] }), null);
});
