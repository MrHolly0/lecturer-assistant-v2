import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const {
  clearLegacyMaxSignedOut,
  clearMaxResume,
  maxIdentityFromInitData,
  readMaxResume,
  readMaxSignedOut,
  setMaxSignedOut,
  writeMaxResume
} = await import("./authResume.ts");

const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    entries: () => [...values.entries()]
  };
}

function initDataFor(id) {
  return `query_id=q&user=${encodeURIComponent(JSON.stringify({ id, first_name: "Test" }))}&hash=signed`;
}

beforeEach(() => {
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
});

after(() => {
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
  if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = originalSessionStorage;
});

test("MAX resume records are scoped to the signed identity and contain no access token", () => {
  const accountA = initDataFor(101);
  const accountB = initDataFor(202);

  assert.equal(maxIdentityFromInitData(accountA), "101");
  writeMaxResume(accountA, "app-account-a", "password");

  assert.deepEqual(readMaxResume(accountA), { accountId: "app-account-a", mode: "password" });
  assert.equal(readMaxResume(accountB), null);
  assert.equal(localStorage.entries().length, 1);
  assert.equal(localStorage.entries()[0][1].includes("accessToken"), false);
  assert.equal(localStorage.entries()[0][1].includes("query_id"), false);
});

test("explicit sign-out stays scoped to the current MAX identity", () => {
  const accountA = initDataFor("max-a");
  const accountB = initDataFor("max-b");
  writeMaxResume(accountA, "app-a", "max");
  writeMaxResume(accountB, "app-b", "password");

  setMaxSignedOut(accountA, true);
  assert.equal(readMaxSignedOut(accountA), true);
  assert.equal(readMaxSignedOut(accountB), false);

  setMaxSignedOut(accountA, false);
  assert.equal(readMaxSignedOut(accountA), false);
  assert.deepEqual(readMaxResume(accountB), { accountId: "app-b", mode: "password" });
});

test("invalid or missing MAX user data cannot address a stored resume identity", () => {
  assert.equal(maxIdentityFromInitData("hash=x&user=not-json"), null);
  assert.equal(maxIdentityFromInitData("hash=x&user=%7B%22id%22%3A%22%22%7D"), null);
  writeMaxResume("hash=x", "app-account", "max");
  assert.equal(localStorage.entries().length, 0);
});

test("a new signed identity does not inherit the prior unscoped in-view logout", () => {
  const accountA = initDataFor("max-a");
  const accountB = initDataFor("max-b");
  setMaxSignedOut(accountA, true);
  clearLegacyMaxSignedOut();

  assert.equal(readMaxSignedOut(accountA), true);
  assert.equal(readMaxSignedOut(accountB), false);
});

test("clearing a resume record does not remove another account's record", () => {
  const accountA = initDataFor("max-a");
  const accountB = initDataFor("max-b");
  writeMaxResume(accountA, "app-a", "max");
  writeMaxResume(accountB, "app-b", "password");

  clearMaxResume(accountA);

  assert.equal(readMaxResume(accountA), null);
  assert.deepEqual(readMaxResume(accountB), { accountId: "app-b", mode: "password" });
});
