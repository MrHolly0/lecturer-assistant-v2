import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { trackStudentDelivery } from "./studentDelivery.ts";

let now, timers, calls, tracker, send, originalWindow, originalNavigator;
const originalNow = Date.now;
const originalRandom = Math.random;
const live = { sessionId: "session-a", status: "LIVE" };
const end = { ...live, status: "ENDED" };
const settle = () => new Promise((done) => setImmediate(done));
async function advance(ms) {
  const until = now + ms;
  for (;;) {
    const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    const [id, timer] = next;
    now = timer.at;
    timers.delete(id);
    timer.fn();
    await settle();
  }
  now = until;
  await settle();
}
beforeEach(() => {
  now = 100000;
  timers = new Map();
  calls = [];
  let id = 0;
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: (fn, ms) => {
        const key = ++id;
        timers.set(key, { fn, at: now + ms });
        return key;
      },
      clearTimeout: (key) => timers.delete(key)
    }
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  Date.now = () => now;
  Math.random = () => 0.5;
  send = async () => undefined;
  tracker = trackStudentDelivery((sessionId, completed, signal) => {
    calls.push({ sessionId, completed, signal, at: now });
    return send(signal);
  });
});
afterEach(() => {
  tracker.stop();
  Date.now = originalNow;
  Math.random = originalRandom;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
});

test("static slide delivery renews quietly and bursts share a bounded write", async () => {
  tracker.received(live);
  await advance(1000);
  for (let i = 0; i < 6; i++) {
    await advance(5000);
    tracker.received(live);
  }
  assert.equal(calls.length, 1);
  await advance(2500);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].completed, false);
});

test("no received data means no attendance renewal, including after a suspended timer wakes", async () => {
  tracker.received(live);
  await advance(1000);
  tracker.received(live);
  await advance(120000);
  assert.equal(calls.length, 1);
  tracker.received(live);
  await advance(1000);
  assert.equal(calls.length, 2);
});

test("completion is immediate, finite, and survives terminal UI cleanup", async () => {
  tracker.received(live);
  await advance(1000);
  tracker.received(end);
  tracker.stop();
  await advance(0);
  assert.equal(calls.at(-1).completed, true);
  tracker.received(end);
  await advance(120000);
  assert.equal(calls.length, 2);
});

test("a terminal frame before the first coalesced receipt still acknowledges the end", async () => {
  tracker.received(live);
  tracker.received(end);
  tracker.stop();
  await advance(0);
  assert.deepEqual(calls.map((c) => c.completed), [true]);
});

test("completion arriving during an ordinary request is not lost", async () => {
  let resolve;
  send = () => new Promise((done) => (resolve = done));
  tracker.received(live);
  await advance(1000);
  tracker.received(end);
  await advance(0);
  assert.equal(calls.length, 1);
  send = async () => undefined;
  resolve();
  await settle();
  await advance(0);
  assert.deepEqual(calls.map((c) => c.completed), [false, true]);
});

test("opening historical results or receiving a kick cannot claim end attendance", async () => {
  tracker.received(end);
  await advance(1000);
  assert.equal(calls.length, 0);
  tracker.received({ ...live, kicked: true });
  tracker.received(end);
  await advance(1000);
  assert.equal(calls.length, 0);
});

test("end retries use backoff and stop after three failures", async () => {
  tracker.received(live);
  await advance(1000);
  send = async () => { throw new TypeError("Network unavailable"); };
  tracker.received(end);
  await advance(60000);
  assert.equal(calls.length, 4);
  const attempts = calls.slice(1);
  assert.ok(attempts[2].at - attempts[1].at > attempts[1].at - attempts[0].at);
});

test("a closed page cancels ordinary requests and cannot mix another session", async () => {
  tracker.received(live);
  tracker.received({ ...live, sessionId: "session-b" });
  await advance(1000);
  tracker.stop();
  tracker.received(end);
  await advance(60000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, "session-a");
});
