import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const { clearStoredAuth, getStoredAuth, setStoredAuth } = await import("../auth.ts");
const { apiFetch, ApiError } = await import("./http.ts");
const { invalidatePendingAuthRefresh, RefreshUnavailableError } = await import("./refresh.ts");

const originalFetch = globalThis.fetch;
const originalSessionStorage = globalThis.sessionStorage;
const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const events = [];

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
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

beforeEach(() => {
  invalidatePendingAuthRefresh();
  globalThis.sessionStorage = storage();
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

test("a transient refresh failure after API 401 preserves stored auth", async () => {
  setStoredAuth({ accessToken: "old-token" });
  globalThis.fetch = async (url) =>
    String(url).endsWith("/auth/refresh") ? response(503) : response(401);

  await assert.rejects(apiFetch("/protected"), RefreshUnavailableError);
  assert.deepEqual(getStoredAuth(), { accessToken: "old-token" });
  assert.equal(
    events.some((event) => event.type === "auth:expired"),
    false
  );
});

test("a second 401 expires the refreshed token that received the retry response", async () => {
  setStoredAuth({ accessToken: "old-token" });
  globalThis.fetch = async (url) =>
    String(url).endsWith("/auth/refresh")
      ? response(200, { accessToken: "new-token", user: { id: "account-a", role: "TEACHER" } })
      : response(401);

  await assert.rejects(
    apiFetch("/protected"),
    (error) => error instanceof ApiError && error.status === 401
  );
  assert.equal(getStoredAuth(), null);
  assert.equal(events.filter((event) => event.type === "auth:expired").length, 1);
});

test("an old retry response cannot clear an account installed while it was in flight", async () => {
  setStoredAuth({ accessToken: "old-token" });
  let protectedCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/auth/refresh")) throw new Error("refresh should not run");
    protectedCalls += 1;
    if (protectedCalls === 1) {
      setStoredAuth({ accessToken: "account-b-token" });
      return response(401);
    }
    setStoredAuth({ accessToken: "account-c-token" });
    return response(401);
  };

  await assert.rejects(
    apiFetch("/protected"),
    (error) => error instanceof ApiError && error.status === 401
  );
  assert.deepEqual(getStoredAuth(), { accessToken: "account-c-token" });
  assert.equal(
    events.some((event) => event.type === "auth:expired"),
    false
  );
});
