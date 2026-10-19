import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const { getStoredAuth } = await import("../auth.ts");
const {
  invalidatePendingAuthRefresh,
  refreshAuthSession,
  RefreshIdentityMismatchError,
  RefreshSupersededError,
  RefreshUnavailableError
} = await import("./refresh.ts");

const originalFetch = globalThis.fetch;
const originalSessionStorage = globalThis.sessionStorage;
const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const events = [];

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

class TestCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
}

function response(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const authBody = (accessToken = "access-1", userId = "person-1") => ({
  accessToken,
  user: { id: userId, role: "TEACHER" }
});

beforeEach(() => {
  invalidatePendingAuthRefresh();
  globalThis.sessionStorage = makeStorage();
  events.length = 0;
  globalThis.window = { dispatchEvent: (event) => events.push(event) };
  globalThis.CustomEvent = TestCustomEvent;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { locks: undefined }
  });
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = originalSessionStorage;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
  else globalThis.CustomEvent = originalCustomEvent;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
});

test("refresh stores valid auth and dispatches the authenticated user", async () => {
  globalThis.fetch = async () => response(200, authBody());

  const refreshed = await refreshAuthSession();

  assert.equal(refreshed.user.id, "person-1");
  assert.deepEqual(getStoredAuth(), { accessToken: "access-1" });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "auth:refreshed");
  assert.equal(events[0].detail.user.id, "person-1");
});

test("concurrent refresh callers share one rotation request", async () => {
  let completeFetch;
  let fetchCount = 0;
  globalThis.fetch = () => {
    fetchCount += 1;
    return new Promise((resolve) => {
      completeFetch = resolve;
    });
  };

  const first = refreshAuthSession();
  const second = refreshAuthSession();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  completeFetch(response(200, authBody()));

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(fetchCount, 1);
  assert.equal(firstResult.accessToken, secondResult.accessToken);
});

test("only authoritative unauthorized/forbidden refresh responses return null", async () => {
  globalThis.fetch = async () => response(401);
  assert.equal(await refreshAuthSession(), null);
  assert.equal(getStoredAuth(), null);
  assert.equal(events.length, 0);

  globalThis.fetch = async () => response(403);
  assert.equal(await refreshAuthSession(), null);
  assert.equal(getStoredAuth(), null);
});

test("server, network, and malformed refresh failures remain recoverable", async (t) => {
  const failures = [
    ["503", async () => response(503, { message: "unavailable" })],
    [
      "network",
      async () => {
        throw new TypeError("offline");
      }
    ],
    ["invalid JSON", async () => new Response("{", { status: 200 })],
    ["incomplete body", async () => response(200, { accessToken: "token-only" })]
  ];

  for (const [name, fetcher] of failures) {
    await t.test(name, async () => {
      invalidatePendingAuthRefresh();
      globalThis.fetch = fetcher;
      await assert.rejects(refreshAuthSession(), RefreshUnavailableError);
      assert.equal(getStoredAuth(), null);
      assert.equal(events.length, 0);
    });
  }
});

test("a cold MAX resume cannot install a cookie for another app account", async () => {
  globalThis.fetch = async () => response(200, authBody("account-b-token", "account-b"));

  await assert.rejects(
    refreshAuthSession({ expectedUserId: "account-a" }),
    RefreshIdentityMismatchError
  );
  assert.equal(getStoredAuth(), null);
  assert.equal(events.length, 0);
});

test("a refresh completing after sign-out cannot restore its access token", async () => {
  let completeFetch;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      completeFetch = resolve;
    });

  const pending = refreshAuthSession();
  await new Promise((resolve) => setImmediate(resolve));
  invalidatePendingAuthRefresh();
  completeFetch(response(200, authBody("late-token")));

  await assert.rejects(pending, RefreshSupersededError);
  assert.equal(getStoredAuth(), null);
  assert.equal(events.length, 0);
});

test("a refresh queued on Web Locks does not contact the server after sign-out", async () => {
  let runLockedCallback;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request: (_name, callback) =>
          new Promise((resolve, reject) => {
            runLockedCallback = () => Promise.resolve().then(callback).then(resolve, reject);
          })
      }
    }
  });
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return response(200, authBody());
  };

  const pending = refreshAuthSession();
  invalidatePendingAuthRefresh();
  runLockedCallback();

  await assert.rejects(pending, RefreshSupersededError);
  assert.equal(fetchCount, 0);
  assert.equal(getStoredAuth(), null);
});
