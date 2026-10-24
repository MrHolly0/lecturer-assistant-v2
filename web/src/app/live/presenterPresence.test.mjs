import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { startPresenterPresence } from "./presenterPresence.ts";
import { ApiError } from "../api/errors.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalNow = Date.now;
const originalRandom = Math.random;
let time, timers, nextTimer, stops;
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
  stops = [];
  Date.now = () => time;
  Math.random = () => 0;
  const target = new EventTarget();
  target.setTimeout = (fn, delay) => {
    const id = nextTimer++;
    timers.set(id, { fn, at: time + delay });
    return id;
  };
  target.clearTimeout = (id) => timers.delete(id);
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  Object.defineProperty(globalThis, "document", { configurable: true, value: new EventTarget() });
  document.visibilityState = "hidden";
});
afterEach(() => {
  for (const stop of stops) stop();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
  Date.now = originalNow;
  Math.random = originalRandom;
});

test("hidden presenter keeps renewing and focus bursts cannot create parallel requests", async () => {
  const pending = [];
  stops.push(startPresenterPresence(() => new Promise((done) => pending.push(done))));
  assert.equal(pending.length, 1);
  advance(60000);
  for (let i = 0; i < 10; i++) window.dispatchEvent(new Event("focus"));
  assert.equal(pending.length, 1);
  pending[0]();
  await settle();
  advance(59999);
  assert.equal(pending.length, 1);
  advance(1);
  assert.equal(pending.length, 2);
});

test("temporary outages back off with jitter and online resumes quietly", async () => {
  let attempts = 0;
  stops.push(startPresenterPresence(async () => { attempts++; throw new TypeError("Offline"); }));
  await settle();
  assert.equal([...timers.values()][0].at - time, 5000);
  advance(5000);
  await settle();
  assert.equal([...timers.values()][0].at - time, 10000);
  advance(5000);
  window.dispatchEvent(new Event("online"));
  await settle();
  assert.equal(attempts, 3);
  assert.equal(timers.size, 1);
});

test("forbidden presence stops and cannot restart on focus", async () => {
  let attempts = 0;
  stops.push(startPresenterPresence(async () => { attempts++; throw new ApiError(403, "Forbidden"); }));
  await settle();
  advance(60000);
  window.dispatchEvent(new Event("focus"));
  assert.equal(attempts, 1);
  assert.equal(timers.size, 0);
});

test("closing the main window aborts its pulse but leaves a separate remote renewing", async () => {
  let mainSignal, finish;
  let remotePulses = 0;
  const closeMain = startPresenterPresence((signal) => {
    mainSignal = signal;
    return new Promise((done) => { finish = done; });
  });
  stops.push(closeMain, startPresenterPresence(async () => { remotePulses++; }));
  await settle();
  closeMain();
  assert.equal(mainSignal.aborted, true);
  finish();
  await settle();
  advance(60000);
  await settle();
  assert.equal(remotePulses, 2);
  assert.equal(timers.size, 1);
});
