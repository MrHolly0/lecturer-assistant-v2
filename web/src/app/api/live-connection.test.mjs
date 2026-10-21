import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { connectLiveSession } from "./live-api.ts";
import { getStoredAuth, setStoredAuth } from "../auth.ts";
import { invalidatePendingAuthRefresh } from "./refresh.ts";

const originals = Object.fromEntries(
  ["window", "document", "navigator", "sessionStorage", "WebSocket", "fetch", "CustomEvent"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]
  )
);
const originalNow = Date.now;
let time, timers, nextTimer, sockets, requests, states, messages, disconnect;
function advance(ms) {
  const until = time + ms;
  for (;;) {
    const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    const [id, task] = next;
    time = task.at;
    if (task.interval) task.at += task.interval;
    else timers.delete(id);
    task.fn();
  }
  time = until;
}
function timer(fn, delay, interval = 0) {
  const id = nextTimer++;
  timers.set(id, { fn, at: time + delay, interval });
  return id;
}
class Socket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  sent = [];
  closes = 0;
  constructor(url) {
    super();
    this.url = url;
    sockets.push(this);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  receive(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  connected(heartbeat = "10000,10000") {
    this.open();
    this.receive(`CONNECTED\nversion:1.2\nheart-beat:${heartbeat}\n\n\0`);
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.closes++;
    this.readyState = 3;
    const event = new Event("close");
    Object.defineProperty(event, "code", { value: code });
    this.dispatchEvent(event);
  }
  send(data) {
    this.sent.push(data);
  }
}
const settle = () => new Promise((done) => setImmediate(done));
function start() {
  disconnect = connectLiveSession(
    "fixture-session",
    (m) => messages.push(m),
    (s) => states.push(s)
  );
  return sockets[0];
}
function focus() {
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("pageshow"));
  document.dispatchEvent(new Event("visibilitychange"));
  advance(0);
}
beforeEach(() => {
  invalidatePendingAuthRefresh();
  time = 100000;
  timers = new Map();
  nextTimer = 1;
  sockets = [];
  requests = [];
  states = [];
  messages = [];
  disconnect = undefined;
  const storage = new Map();
  const win = Object.assign(new EventTarget(), {
    location: { protocol: "https:", host: "fixture.example.test" },
    setTimeout: (fn, delay) => timer(fn, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => timer(fn, delay, delay),
    clearInterval: (id) => timers.delete(id)
  });
  for (const [key, value] of Object.entries({
    window: win,
    document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
    navigator: { onLine: true },
    WebSocket: Socket,
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    CustomEvent: class extends Event {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    },
    fetch: async (url) => {
      requests.push(url);
      return new Response(
        JSON.stringify({ accessToken: "refreshed", user: { id: "fixture", role: "TEACHER" } }),
        { status: 200 }
      );
    }
  }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  Date.now = () => time;
  setStoredAuth({ accessToken: "original" });
});
afterEach(() => {
  disconnect?.();
  invalidatePendingAuthRefresh();
  Date.now = originalNow;
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test("focus, pageshow and visibility preserve a healthy socket and subscription", () => {
  const socket = start();
  socket.connected();
  assert.match(socket.sent[0], /heart-beat:10000,10000/);
  for (let i = 0; i < 20; i++) {
    advance(500);
    socket.receive("\n");
    focus();
  }
  assert.equal(sockets.length, 1);
  assert.equal(socket.closes, 0);
  assert.equal(socket.sent.filter((s) => s.startsWith("SUBSCRIBE")).length, 1);
  assert.equal(states.at(-1), "connected");
  assert.equal(requests.length, 0);
});
test("a slow STOMP handshake retries transport without rotating authentication", () => {
  const socket = start();
  socket.open();
  advance(9999);
  focus();
  assert.equal(socket.closes, 0);
  advance(1);
  assert.equal(socket.closes, 1);
  assert.equal(requests.length, 0);
  advance(500);
  assert.equal(sockets.length, 2);
  sockets[1].connected();
  assert.equal(states.at(-1), "connected");
  assert.equal(getStoredAuth().accessToken, "original");
});
test("negotiated heartbeats keep an idle connection alive and detect a stalled one", () => {
  const socket = start();
  socket.connected();
  for (let i = 0; i < 6; i++) {
    advance(9000);
    socket.receive("\n");
  }
  assert.equal(socket.closes, 0);
  assert.ok(socket.sent.includes("\n"));
  advance(50000);
  assert.equal(socket.closes, 1);
  assert.ok(sockets.length >= 2);
  assert.equal(requests.length, 0);
});
test("resume reconnects a suspended stale socket, while late old frames cannot affect the replacement", () => {
  const socket = start();
  socket.connected();
  // Browser timers are suspended while the computer is asleep.
  time += 60000;
  timers.clear();
  focus();
  advance(0);
  assert.equal(socket.closes, 1);
  assert.equal(sockets.length, 2);
  sockets[1].connected();
  const count = states.length;
  socket.receive('MESSAGE\n\n{"type":"late","session":{}}\0');
  socket.dispatchEvent(new Event("close"));
  assert.equal(states.length, count);
  assert.deepEqual(messages, []);
});
test("policy rejection refreshes once, then backs off if the replacement is rejected too", async () => {
  const socket = start();
  socket.connected();
  socket.close(1008);
  await settle();
  assert.equal(requests.length, 1);
  advance(0);
  assert.equal(sockets.length, 2);
  sockets[1].connected();
  sockets[1].close(1008);
  await settle();
  assert.equal(requests.length, 1);
  advance(500);
  assert.equal(sockets.length, 3);
});
test("a network error during policy refresh preserves credentials and schedules another connection", async () => {
  globalThis.fetch = async (url) => {
    requests.push(url);
    throw new TypeError("offline");
  };
  const socket = start();
  socket.connected();
  socket.close(1008);
  await settle();
  assert.equal(getStoredAuth().accessToken, "original");
  advance(500);
  assert.equal(sockets.length, 2);
  assert.equal(requests.length, 1);
});
test("offline status is reported and cleanup stops every reconnect and heartbeat", () => {
  const socket = start();
  socket.connected();
  navigator.onLine = false;
  window.dispatchEvent(new Event("offline"));
  assert.equal(states.at(-1), "offline");
  navigator.onLine = true;
  window.dispatchEvent(new Event("online"));
  advance(0);
  sockets.at(-1).connected();
  disconnect();
  disconnect = undefined;
  assert.equal(timers.size, 0);
  const count = sockets.length;
  focus();
  advance(60000);
  assert.equal(sockets.length, count);
  assert.equal(requests.length, 0);
});
