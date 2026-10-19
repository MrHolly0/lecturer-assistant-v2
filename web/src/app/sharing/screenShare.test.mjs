import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
const original = await readFile(new URL("./screenShare.ts", import.meta.url), "utf8");
const scope = { courseId: "course", sessionId: "session", joinCode: "ABC123" };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function media(surface = "window") {
  const track = Object.assign(new EventTarget(), {
    label: "Material",
    enabled: true,
    stopped: false,
    getSettings: () => ({ displaySurface: surface }),
    stop() {
      this.stopped = true;
    }
  });
  return { getVideoTracks: () => [track], getTracks: () => [track], track };
}
async function fixture(t, capture) {
  const globals = new Map(
    ["window", "navigator", "setInterval", "clearInterval", "BroadcastChannel"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    ])
  );
  const requests = [],
    intervals = new Map(),
    channels = [],
    listeners = new Set();
  let counter = 0,
    attemptId = "ce8beec2-2b1c-4b4b-a25e-e1b42af6ecb2";
  const api = {
    capture,
    start: async () => ({
      id: "share",
      leaseUntil: new Date(Date.now() + 10000).toISOString(),
      peers: [],
      iceServers: [],
      paused: false
    }),
    poll: () => new Promise(() => {}),
    stop: async () => {}
  };
  globalThis.__laShareTest = {
    api,
    requests,
    projection: {
      getSnapshot: () => ({ attemptId }),
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    },
    channel: (code, id) => {
      const channel = {
        name: `${code}:${id}`,
        messages: [],
        postMessage(value) {
          this.messages.push(value);
        },
        close() {
          this.closed = true;
        }
      };
      channels.push(channel);
      return channel;
    }
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: (options) => {
          requests.push(["capture", options]);
          return api.capture();
        }
      }
    }
  });
  Object.defineProperty(globalThis, "setInterval", {
    configurable: true,
    value: (fn) => {
      const id = ++counter;
      intervals.set(id, fn);
      return id;
    }
  });
  Object.defineProperty(globalThis, "clearInterval", {
    configurable: true,
    value: (id) => intervals.delete(id)
  });
  const mocks = `const f=globalThis.__laShareTest; export const startShare=(...args)=>{f.requests.push(['start',...args]);return f.api.start(...args)}; export const pollShare=(...args)=>f.api.poll(...args); export const stopShare=(...args)=>{f.requests.push(['stop',...args]);return f.api.stop(...args)}; export const offerShare=async()=>{}; export const uploadShareFrame=async()=>{}; export class ApiError extends Error {status=403}; export const browserProjection=f.projection; export const bindPublicProjection=(...args)=>f.requests.push(['bind',...args]); export const gatheredDescription=async()=>''; export const localShareChannel=f.channel; export class ShareVideoPublisher {async start(){} stop(){}};`;
  const mockUrl = `data:text/javascript,${encodeURIComponent(mocks)}`;
  let source = original
    .replace('from "../projection/browserProjection"', `from ${JSON.stringify(mockUrl)}`)
    .replace('from "../api/http"', `from ${JSON.stringify(mockUrl)}`)
    .replace('from "../api/share-api"', `from ${JSON.stringify(mockUrl)}`)
    .replace('from "./rtc"', `from ${JSON.stringify(mockUrl)}`)
    .replace('from "./videoPublisher"', `from ${JSON.stringify(mockUrl)}`)
    .replace(
      'from "./capturePolicy"',
      `from ${JSON.stringify(new URL("./capturePolicy.ts", import.meta.url).href)}`
    );
  // A unique mock URL prevents another singleton's imports from retaining this fixture.
  source = source.replaceAll(mockUrl, mockUrl + `#${Math.random()}`);
  const module = await import(
    `data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}#${Math.random()}`
  );
  const controller = module.screenShare;
  t.after(async () => {
    await controller.stop();
    for (const [key, descriptor] of globals)
      descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
    delete globalThis.__laShareTest;
  });
  return {
    controller,
    api,
    requests,
    intervals,
    channels,
    changeAttempt: (id) => {
      attemptId = id;
      listeners.forEach((fn) => fn());
    }
  };
}
test("window and monitor capture stay local until the teacher explicitly publishes", async (t) => {
  const stream = media();
  const f = await fixture(t, async () => stream);
  await f.controller.choose(scope);
  assert.equal(f.controller.getSnapshot().phase, "preview");
  assert.equal(f.requests.filter((x) => x[0] === "start").length, 0);
  await f.controller.stop();
  assert.equal(stream.track.stopped, true);
  const monitor = media("monitor");
  f.api.capture = async () => monitor;
  await f.controller.choose(scope);
  assert.equal(monitor.track.stopped, false);
  assert.equal(f.controller.getSnapshot().phase, "preview");
  assert.equal(f.controller.getSnapshot().surface, "monitor");
  assert.equal(f.controller.getSnapshot().sourceName, "Экран преподавателя");
  assert.equal(f.requests.filter((x) => x[0] === "start").length, 0);
  await f.controller.stop();
  assert.equal(monitor.track.stopped, true);
});
test("a late browser permission response cannot resurrect capture after stop", async (t) => {
  const permission = deferred(),
    f = await fixture(t, () => permission.promise);
  const choosing = f.controller.choose(scope);
  await f.controller.stop();
  const stream = media();
  permission.resolve(stream);
  await choosing;
  assert.equal(stream.track.stopped, true);
  assert.equal(f.controller.getSnapshot().phase, "idle");
});
test("late publishing failure cannot overwrite a new preview", async (t) => {
  const f = await fixture(t, async () => media());
  const pending = deferred();
  f.api.start = () => pending.promise;
  await f.controller.choose(scope);
  const publishing = f.controller.publish();
  await f.controller.stop();
  await f.controller.choose(scope);
  pending.reject(new Error("old failure"));
  await publishing;
  assert.equal(f.controller.getSnapshot().phase, "preview");
  assert.equal(f.controller.getSnapshot().error, null);
});
test("lease expiry immediately stops all tracks and a new physical test rebinds the secret local channel", async (t) => {
  const stream = media(),
    f = await fixture(t, async () => stream);
  const expiry = Date.now() - 1000;
  f.api.start = async () => ({
    id: "share",
    leaseUntil: new Date(expiry).toISOString(),
    peers: [],
    iceServers: [],
    paused: false
  });
  await f.controller.choose(scope);
  await f.controller.publish();
  const first = f.channels[0];
  assert.match(first.name, /ABC123:ce8beec2/);
  f.changeAttempt("985bc836-bf50-4a43-806a-d6c94469cc0c");
  assert.equal(first.closed, true);
  assert.match(f.channels[1].name, /985bc836/);
  [...f.intervals.values()][0]();
  assert.equal(stream.track.stopped, true);
  assert.equal(f.controller.getSnapshot().phase, "error");
  assert.equal(f.controller.getSnapshot().stream, null);
});
