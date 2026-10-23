import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { clearStoredAuth, getStoredAuth, setStoredAuth } from "../auth.ts";
import { loginWithMax, previewMaxLink } from "./auth-api.ts";
import { invalidatePendingAuthRefresh, RefreshSupersededError } from "./refresh.ts";

const originalFetch = globalThis.fetch;
const originalStorage = globalThis.sessionStorage;
const response = (status, body = {}) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  invalidatePendingAuthRefresh();
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = originalStorage;
});

test("a late automatic MAX login cannot restore auth after an explicit exit", async () => {
  let complete;
  globalThis.fetch = () => new Promise((resolve) => { complete = resolve; });
  const pending = loginWithMax("fixture-launch", undefined, undefined, true);
  invalidatePendingAuthRefresh();
  clearStoredAuth();
  complete(response(200, { accessToken: "late-access" }));
  await assert.rejects(pending, RefreshSupersededError);
  assert.equal(getStoredAuth(), null);
});

test("a temporary MAX login outage preserves the warm credentials", async () => {
  setStoredAuth({ accessToken: "warm-access" });
  globalThis.fetch = async () => response(503);
  await assert.rejects(loginWithMax("fixture-launch", undefined, undefined, true));
  assert.deepEqual(getStoredAuth(), { accessToken: "warm-access" });
});

test("a rejected MAX identity cannot fall back to a different browser refresh cookie", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url).endsWith("/auth/max")
      ? response(200, { accessToken: "max-access" })
      : response(401);
  };
  await assert.rejects(loginWithMax("fixture-launch", undefined, undefined, true));
  assert.equal(calls.some((url) => url.endsWith("/auth/refresh")), false);
  assert.equal(getStoredAuth(), null);
});

test("a late MAX link confirmation cannot restore auth after exit", async () => {
  const { confirmMaxLink } = await import("./auth-api.ts");
  let complete;
  globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
  const pending = confirmMaxLink("fixture-launch", "fixture-review");
  invalidatePendingAuthRefresh();
  clearStoredAuth();
  complete(response(200, { accessToken: "late-link-access" }));
  await assert.rejects(pending, RefreshSupersededError);
  assert.equal(getStoredAuth(), null);
});

test("an outdated confirmation cannot clear a newly selected account", async () => {
  const { confirmMaxLink } = await import("./auth-api.ts");
  let complete;
  globalThis.fetch = async url => String(url).endsWith("/link-confirm")
    ? response(200, { accessToken: "linked-access" })
    : new Promise(resolve => { complete = resolve; });
  const pending = confirmMaxLink("fixture-launch", "fixture-review");
  while (!complete) await new Promise(resolve => setTimeout(resolve, 0));
  invalidatePendingAuthRefresh();
  setStoredAuth({ accessToken: "new-account-access" });
  complete(response(200, { id: "old-linked-account", role: "LECTURER" }));
  await assert.rejects(pending, RefreshSupersededError);
  assert.deepEqual(getStoredAuth(), { accessToken: "new-account-access" });
});

test("MAX preview preserves the rejected launch reason without expiring an existing session", async () => {
  setStoredAuth({ accessToken: "warm-access" });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return response(401, { message: "Invalid MAX initData" });
  };
  await assert.rejects(previewMaxLink({ initData: "old-launch", email: "fixture@example.test", password: "fixture-secret" }), error => {
    assert.equal(error.status, 401);
    assert.equal(error.details.message, "Invalid MAX initData");
    assert.match(error.message, /Данные входа MAX/);
    return true;
  });
  assert.deepEqual(getStoredAuth(), { accessToken: "warm-access" });
  assert.deepEqual(calls, ["/api/v1/auth/max/link-preview"]);
});

test("MAX preview preserves a credential rejection separately from launch validation", async () => {
  globalThis.fetch = async () => response(401, { message: "Invalid credentials" });
  await assert.rejects(previewMaxLink({ initData: "fresh-launch", email: "fixture@example.test", password: "incorrect" }), error => {
    assert.equal(error.status, 401);
    assert.equal(error.details.message, "Invalid credentials");
    return true;
  });
});
