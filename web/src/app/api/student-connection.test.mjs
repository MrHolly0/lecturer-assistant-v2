import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { setMaxListeners } from "node:events";
import { connectStudentSession, getStudentSession } from "./student-api.ts";

const originals = Object.fromEntries(
  ["window", "document", "navigator", "sessionStorage", "EventSource", "fetch"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key)
  ])
);
const originalNow = Date.now;
const originalRandom = Math.random;
let time, timers, nextTimer, sources, requests, snapshots, states, controls, cleanup;
const settle = () => new Promise((done) => setImmediate(done));
function timer(fn, delay) {
  const id = nextTimer++;
  timers.set(id, { fn, at: time + delay });
  return id;
}
async function advance(ms) {
  const until = time + ms;
  for (;;) {
    const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    const [id, task] = next;
    time = task.at;
    timers.delete(id);
    task.fn();
    await settle();
  }
  time = until;
  await settle();
}
class Source extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  closes = 0;
  constructor(url) {
    super();
    this.url = url;
    this.startedAt = time;
    sources.push(this);
  }
  open() {
    this.readyState = Source.OPEN;
    this.onopen?.();
  }
  fail() {
    this.readyState = Source.CLOSED;
    this.onerror?.();
  }
  snapshot(value) {
    this.dispatchEvent(new MessageEvent("snapshot", { data: JSON.stringify(value) }));
  }
  close() {
    this.closes++;
    this.readyState = Source.CLOSED;
  }
}
function start(token = "participant-fixture") {
  controls = connectStudentSession(
    "FIXTURE",
    token,
    (s) => snapshots.push(s),
    (s) => states.push(s)
  );
  cleanup.push(controls);
  return sources.at(-1);
}
function focus() {
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("pageshow"));
  document.dispatchEvent(new Event("visibilitychange"));
}
async function reachPolling() {
  start().fail();
  await advance(750);
  sources.at(-1).fail();
  await advance(1500);
  sources.at(-1).fail();
  await advance(750);
  assert.equal(requests.length, 1);
}
beforeEach(() => {
  time = 100000;
  timers = new Map();
  nextTimer = 1;
  sources = [];
  requests = [];
  snapshots = [];
  states = [];
  cleanup = [];
  const storage = new Map();
  const win = Object.assign(new EventTarget(), {
    setTimeout: timer,
    clearTimeout: (id) => timers.delete(id)
  });
  for (const [key, value] of Object.entries({
    window: win,
    document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
    navigator: { onLine: true },
    EventSource: Source,
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    fetch: async (url, init) => {
      requests.push({ url, init, at: time });
      return new Response(JSON.stringify({ version: 1, status: "LIVE", questionAnswers: [] }));
    }
  }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  setMaxListeners(0, window, document);
  Date.now = () => time;
  Math.random = () => 0.5;
});
afterEach(() => {
  for (const connection of cleanup) connection.disconnect();
  Date.now = originalNow;
  Math.random = originalRandom;
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test("focus bursts preserve a healthy or connecting SSE without extra HTTP reads", async () => {
  const source = start();
  focus();
  await advance(0);
  assert.equal(sources.length, 1);
  source.open();
  source.snapshot({ version: 3, status: "LIVE", questionAnswers: [] });
  for (let i = 0; i < 20; i++) {
    focus();
    await advance(500);
  }
  assert.equal(sources.length, 1);
  assert.equal(source.closes, 0);
  assert.equal(requests.length, 0);
  assert.equal(states.at(-1), "CONNECTED");
});

test("rapid SSE open/error flapping retains exponential backoff until a stable channel", async () => {
  const source = start();
  source.open();
  source.fail();
  await advance(749);
  assert.equal(sources.length, 1);
  await advance(1);
  sources.at(-1).open();
  sources.at(-1).fail();
  await advance(1499);
  assert.equal(sources.length, 2);
  await advance(1);
  sources.at(-1).open();
  sources.at(-1).fail();
  await advance(2999);
  assert.equal(sources.length, 3);
  await advance(1);
  const stable = sources.at(-1);
  stable.open();
  await advance(10000);
  stable.fail();
  await advance(750);
  assert.equal(sources.at(-1).startedAt, time);
});

test("slow HTTP polling stays single flight, aborts at its deadline and backs off", async () => {
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = (url, init) => {
    requests.push({ url, init, at: time });
    maxActive = Math.max(maxActive, ++active);
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => {
          active--;
          reject(init.signal.reason);
        },
        { once: true }
      );
    });
  };
  await reachPolling();
  const first = requests[0];
  for (let i = 0; i < 3; i++) {
    focus();
    controls.reconnect();
    await advance(3000);
  }
  assert.equal(requests.length, 1);
  assert.equal(active, 1);
  await advance(3000);
  assert.equal(first.init.signal.aborted, true);
  assert.equal(first.init.signal.reason.name, "TimeoutError");
  assert.equal(active, 0);
  await advance(4499);
  assert.equal(requests.length, 1);
  await advance(1);
  assert.equal(requests.length, 2);
  assert.equal(maxActive, 1);
});

test("Retry-After remains a minimum across polling and resume events", async () => {
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init, at: time });
    return new Response("busy", { status: 429, headers: { "Retry-After": "60" } });
  };
  await reachPolling();
  const firstAt = requests[0].at;
  for (let i = 0; i < 59; i++) {
    focus();
    controls.reconnect();
    await advance(1000);
  }
  assert.equal(requests.length, 1);
  await advance(1500);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].at - firstAt >= 60000);
});

test("SSE recovery aborts a pending read and a late HTTP snapshot cannot overwrite personalized state", async () => {
  let finish;
  globalThis.fetch = (url, init) => {
    requests.push({ url, init, at: time });
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  await reachPolling();
  await advance(2250);
  const recovered = sources.at(-1);
  recovered.open();
  recovered.snapshot({
    version: 5,
    status: "LIVE",
    questionAnswers: [{ questionId: "own", text: "private" }]
  });
  assert.equal(requests[0].init.signal.aborted, true);
  finish(new Response(JSON.stringify({ version: 99, status: "LIVE", questionAnswers: [] })));
  await settle();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].version, 5);
  assert.equal(snapshots[0].questionAnswers[0].text, "private");
  await advance(20000);
  assert.equal(requests.length, 1);
});

test("offline and disconnect cancel work, and an ended lecture never reconnects", async () => {
  const source = start();
  source.open();
  navigator.onLine = false;
  window.dispatchEvent(new Event("offline"));
  assert.equal(states.at(-1), "OFFLINE");
  await advance(60000);
  assert.equal(requests.length, 0);
  assert.equal(sources.length, 1);
  navigator.onLine = true;
  window.dispatchEvent(new Event("online"));
  focus();
  await advance(750);
  assert.equal(sources.length, 2);
  sources[1].open();
  sources[1].snapshot({ version: 6, status: "ENDED", questionAnswers: [] });
  assert.equal(states.at(-1), "ENDED");
  controls.reconnect();
  focus();
  await advance(60000);
  assert.equal(sources.length, 2);
  controls.disconnect();
  assert.equal(timers.size, 0);
});

test("snapshot reads keep participant credentials in headers and use a cancelable body deadline", async () => {
  const parent = new AbortController();
  const result = await getStudentSession("FIXTURE", "private-token", parent.signal);
  assert.equal(result.version, 1);
  assert.equal(new Headers(requests[0].init.headers).get("X-Participant-Token"), "private-token");
  assert.equal(requests[0].url.includes("private-token"), false);
  assert.equal(timers.size, 0);
  assert.equal(requests[0].init.signal.aborted, false);
});

test("an entire disconnected class spreads reconnects instead of starting in one retry wave", async () => {
  let random = 0;
  Math.random = () => ((random++ % 100) + 1) / 100;
  for (let i = 0; i < 100; i++) start(`participant-${i}`).fail();
  const scheduled = [...timers.values()].map((t) => t.at);
  assert.equal(new Set(scheduled).size, 100);
  await advance(750);
  assert.ok(sources.length > 100 && sources.length < 200);
  focus();
  await advance(250);
  assert.equal(sources.length, 200);
  assert.equal(requests.length, 0);
});

test("a read deadline includes a response body that never finishes", async () => {
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init, at: time });
    return { ok: true, json: () => new Promise(() => {}) };
  };
  const pending = getStudentSession("FIXTURE", "private-token");
  const rejected = assert.rejects(pending, (error) => error.name === "TimeoutError");
  await advance(12000);
  await rejected;
  assert.equal(requests[0].init.signal.aborted, true);
  assert.equal(timers.size, 0);
});

test("cancelled account or route scopes cannot start or complete a snapshot read", async () => {
  const parent = new AbortController();
  parent.abort();
  await assert.rejects(
    getStudentSession("FIXTURE", "private-token", parent.signal),
    (error) => error.name === "AbortError"
  );
  assert.equal(requests.length, 0);
  assert.equal(timers.size, 0);
});
