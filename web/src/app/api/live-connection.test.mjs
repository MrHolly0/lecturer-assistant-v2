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
const originalRandom = Math.random;
let time, timers, nextTimer, sockets, requests, states, messages, disconnect;
async function advance(ms) {
  const until = time + ms;
  for (;;) {
    const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    const [id, task] = next;
    time = task.at;
    if (task.interval) task.at += task.interval;
    else timers.delete(id);
    task.fn();
    await settle();
  }
  time = until;
  await settle();
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
  constructor(url, protocols) {
    super();
    this.url = url;
    this.protocols = protocols;
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
async function start() {
  disconnect = connectLiveSession(
    "fixture-session",
    (m) => messages.push(m),
    (s) => states.push(s)
  );
  await settle();
  return sockets[0];
}
async function focus() {
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("pageshow"));
  document.dispatchEvent(new Event("visibilitychange"));
  await advance(0);
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
      if (url.endsWith("/realtime-ticket"))
        return new Response(JSON.stringify({ transport: "ticket", ticket: "fixture-only" }));
      requests.push(url);
      return new Response(
        JSON.stringify({ accessToken: "refreshed", user: { id: "fixture", role: "TEACHER" } }),
        { status: 200 }
      );
    }
  }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  Date.now = () => time;
  Math.random = () => 0.5;
  setStoredAuth({ accessToken: "original" });
});
afterEach(() => {
  disconnect?.();
  invalidatePendingAuthRefresh();
  Date.now = originalNow;
  Math.random = originalRandom;
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test("focus, pageshow and visibility preserve a healthy socket and subscription", async () => {
  const socket = await start();
  socket.connected();
  assert.match(socket.sent[0], /heart-beat:10000,10000/);
  assert.deepEqual(socket.protocols, ["lecturer.v1", "ticket.fixture-only"]);
  assert.equal(socket.url.includes("fixture-only"), false);
  for (let i = 0; i < 20; i++) {
    await advance(500);
    socket.receive("\n");
    await focus();
  }
  assert.equal(sockets.length, 1);
  assert.equal(socket.closes, 0);
  assert.equal(socket.sent.filter((s) => s.startsWith("SUBSCRIBE")).length, 1);
  assert.equal(states.at(-1), "connected");
  assert.equal(requests.length, 0);
});
test("a slow STOMP handshake retries transport without rotating authentication", async () => {
  const socket = await start();
  socket.open();
  await advance(9999);
  await focus();
  assert.equal(socket.closes, 0);
  await advance(1);
  assert.equal(socket.closes, 1);
  assert.equal(requests.length, 0);
  await advance(500);
  assert.equal(sockets.length, 2);
  sockets[1].connected();
  assert.equal(states.at(-1), "connected");
  assert.equal(getStoredAuth().accessToken, "original");
});
test("negotiated heartbeats keep an idle connection alive and detect a stalled one", async () => {
  const socket = await start();
  socket.connected();
  for (let i = 0; i < 6; i++) {
    await advance(9000);
    socket.receive("\n");
  }
  assert.equal(socket.closes, 0);
  assert.ok(socket.sent.includes("\n"));
  await advance(50000);
  assert.equal(socket.closes, 1);
  assert.ok(sockets.length >= 2);
  assert.equal(requests.length, 0);
});
test("resume reconnects a suspended stale socket, while late old frames cannot affect the replacement", async () => {
  const socket = await start();
  socket.connected();
  // Browser timers are suspended while the computer is asleep.
  time += 60000;
  timers.clear();
  await focus();
  await advance(0);
  assert.equal(socket.closes, 1);
  assert.equal(sockets.length, 1);
  await advance(500);
  assert.equal(sockets.length, 2);
  sockets[1].connected();
  const count = states.length;
  socket.receive('MESSAGE\n\n{"type":"late","session":{}}\0');
  socket.dispatchEvent(new Event("close"));
  assert.equal(states.length, count);
  assert.deepEqual(messages, []);
});
test("policy rejection refreshes once, then backs off if the replacement is rejected too", async () => {
  const socket = await start();
  socket.connected();
  socket.close(1008);
  await settle();
  assert.equal(requests.length, 1);
  await advance(0);
  assert.equal(sockets.length, 2);
  sockets[1].connected();
  sockets[1].close(1008);
  await settle();
  assert.equal(requests.length, 1);
  await advance(500);
  assert.equal(sockets.length, 3);
});
test("a network error during policy refresh preserves credentials and schedules another connection", async () => {
  globalThis.fetch = async (url) => {
    if (url.endsWith("/realtime-ticket"))
      return new Response(JSON.stringify({ transport: "ticket", ticket: "fixture-only" }));
    requests.push(url);
    throw new TypeError("offline");
  };
  const socket = await start();
  socket.connected();
  socket.close(1008);
  await settle();
  assert.equal(getStoredAuth().accessToken, "original");
  await advance(500);
  assert.equal(sockets.length, 2);
  assert.equal(requests.length, 1);
});
test("offline status is reported and cleanup stops every reconnect and heartbeat", async () => {
  const socket = await start();
  socket.connected();
  navigator.onLine = false;
  window.dispatchEvent(new Event("offline"));
  assert.equal(states.at(-1), "offline");
  navigator.onLine = true;
  window.dispatchEvent(new Event("online"));
  await advance(500);
  sockets.at(-1).connected();
  disconnect();
  disconnect = undefined;
  assert.equal(timers.size, 0);
  const count = sockets.length;
  await focus();
  await advance(60000);
  assert.equal(sockets.length, count);
  assert.equal(requests.length, 0);
});

test("a stalled TCP/TLS handshake has a deadline before the socket opens", async () => {
  const socket = await start();
  await advance(9999);
  assert.equal(socket.closes, 0);
  await advance(1);
  assert.equal(socket.closes, 1);
  await advance(375);
  assert.equal(sockets.length, 2);
  assert.equal(requests.length, 0);
});
test("flapping sockets and repeated foreground events retain exponential jitter", async () => {
  const first = await start();
  first.connected();
  first.close();
  for (let i = 0; i < 5; i++) await focus();
  await advance(374);
  assert.equal(sockets.length, 1);
  await advance(1);
  sockets[1].connected();
  sockets[1].close();
  for (let i = 0; i < 5; i++) {
    window.dispatchEvent(new Event("online"));
    await focus();
  }
  await advance(749);
  assert.equal(sockets.length, 2);
  await advance(1);
  assert.equal(sockets.length, 3);
});

test("disconnect during ticket acquisition cannot open a late websocket", async () => {
  let release;
  globalThis.fetch = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  disconnect = connectLiveSession(
    "fixture-session",
    () => {},
    () => {}
  );
  await settle();
  disconnect();
  release(Response.json({ transport: "ticket", ticket: "late" }));
  await settle();
  await advance(60000);
  assert.equal(sockets.length, 0);
  assert.equal(timers.size, 0);
});
