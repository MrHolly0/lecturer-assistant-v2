import assert from "node:assert/strict";
import { test } from "node:test";
import { StudentSnapshotGate } from "./student-snapshot-gate.ts";

test("rejects older revisions and accepts equal revisions with fresher engagement", () => {
  const gate = new StudentSnapshotGate();
  assert.equal(gate.accept({ version: 4, myVote: null }), true);
  assert.equal(gate.accept({ version: 3, myVote: 1 }), false);
  assert.equal(gate.current?.myVote, null);
  assert.equal(gate.accept({ version: 4, myVote: 1 }), true);
  assert.equal(gate.current?.myVote, 1);
});

test("an HTTP response started before a newer SSE snapshot cannot roll it back", () => {
  const gate = new StudentSnapshotGate();
  const requestStartedAt = gate.generation;
  assert.equal(gate.accept({ version: 7, myQuestions: ["saved question"] }), true);
  assert.equal(gate.acceptRequest({ version: 7, myQuestions: [] }, requestStartedAt), false);
  assert.deepEqual(gate.current?.myQuestions, ["saved question"]);
});

test("accepts equal revision HTTP snapshots when no newer snapshot overtook the request", () => {
  const gate = new StudentSnapshotGate();
  gate.accept({ version: 2, myVote: null });
  const requestStartedAt = gate.generation;
  assert.equal(gate.acceptRequest({ version: 2, myVote: 1 }, requestStartedAt), true);
  assert.equal(gate.current?.myVote, 1);
});
