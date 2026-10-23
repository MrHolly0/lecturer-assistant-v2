import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createSnapshotInvalidationReader } from "./snapshotInvalidation.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNow = Date.now;
const originalRandom = Math.random;
let time, timers, nextTimer, reader;
const settle = () => new Promise((done) => setImmediate(done));
function advance(ms) {
  time += ms;
  for (const [id, task] of [...timers]) {
    if (task.at > time) continue;
    timers.delete(id);
    task.fn();
  }
}
beforeEach(() => {
  time = 10000;
  timers = new Map();
  nextTimer = 1;
  Date.now = () => time;
  Math.random = () => 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout(fn, delay) {
        const id = nextTimer++;
        timers.set(id, { fn, at: time + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id)
    }
  });
});
afterEach(() => {
  reader?.dispose();
  reader = undefined;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
  Date.now = originalNow;
  Math.random = originalRandom;
});

test("invalidation bursts join one read and coalesce newer revisions into one quiet follow-up", async () => {
  let version = 1;
  const reads = [];
  reader = createSnapshotInvalidationReader(
    () => new Promise((done) => reads.push(done)),
    () => version
  );
  for (let i = 2; i <= 20; i++) reader.invalidate(i);
  advance(0);
  assert.equal(reads.length, 1);
  for (let i = 21; i <= 40; i++) reader.invalidate(i);
  advance(5000);
  assert.equal(reads.length, 1, "no parallel HTTP reads");
  version = 10; // Joined request started before the latest invalidation.
  reads[0](true);
  await settle();
  advance(0);
  assert.equal(reads.length, 2);
  version = 40;
  reads[1](true);
  await settle();
  advance(10000);
  assert.equal(reads.length, 2);
  reader.invalidate(35);
  advance(10000);
  assert.equal(reads.length, 2, "an older notification cannot replace a newer snapshot");
});

test("a lagging HTTP snapshot has one spaced follow-up then waits for periodic recovery", async () => {
  let reads = 0;
  reader = createSnapshotInvalidationReader(async () => (reads++, true), () => 1);
  reader.invalidate(2);
  advance(0);
  await settle();
  assert.equal(reads, 1);
  advance(999);
  assert.equal(reads, 1);
  advance(1);
  await settle();
  assert.equal(reads, 2);
  advance(60000);
  assert.equal(reads, 2, "no tight loop if a replica/snapshot lags behind");
});

test("failure respects existing HTTP recovery and disposal cancels deferred work", async () => {
  let reads = 0;
  reader = createSnapshotInvalidationReader(async () => (reads++, false), () => 1);
  reader.invalidate(2);
  advance(0);
  await settle();
  advance(60000);
  assert.equal(reads, 1);
  reader.invalidate(3);
  reader.dispose();
  advance(60000);
  assert.equal(reads, 1);
});
