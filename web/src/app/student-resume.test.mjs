import assert from "node:assert/strict";
import test from "node:test";
import { parseStudentResume, readTabStudentToken, storeTabStudentToken } from "./studentResume.ts";

const guestReceipt = JSON.stringify({
  joinCode: "ABC123",
  participantToken: "participant-token-1234567890"
});
const accountAReceipt = JSON.stringify({
  joinCode: "ABC123",
  participantToken: "participant-token-1234567890",
  userId: "account-a"
});

function withSessionStorage(run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const values = new Map();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    }
  });
  try {
    run(values);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else delete globalThis.sessionStorage;
  }
}

test("a guest resume receipt can be claimed after the student logs in", () => {
  assert.equal(parseStudentResume(guestReceipt, "ABC123", "account-a")?.userId, undefined);
});

test("a resume receipt bound to one account cannot be read by another", () => {
  assert.equal(parseStudentResume(accountAReceipt, "ABC123", "account-b"), null);
});

test("a guest cannot read a receipt bound to a known account", () => {
  assert.equal(parseStudentResume(accountAReceipt, "ABC123", null), null);
});

test("the account bound to a resume receipt can read it", () => {
  assert.equal(parseStudentResume(accountAReceipt, "ABC123", "account-a")?.userId, "account-a");
});

test("a guest can resume its scoped token without reading a legacy account token", () => {
  withSessionStorage((values) => {
    values.set("student-session:ABC123", "legacy-account-token");
    storeTabStudentToken("ABC123", "guest-token", null);

    assert.equal(readTabStudentToken("ABC123", null), "guest-token");
    assert.equal(readTabStudentToken("ABC123", "account-a"), null);
  });
});

test("an account tab token is unavailable to guests and other accounts", () => {
  withSessionStorage(() => {
    storeTabStudentToken("ABC123", "account-a-token", "account-a");

    assert.equal(readTabStudentToken("ABC123", "account-a"), "account-a-token");
    assert.equal(readTabStudentToken("ABC123", "account-b"), null);
    assert.equal(readTabStudentToken("ABC123", null), null);
  });
});

test("claiming a guest token stores the account token and clears only same-code legacy keys", () => {
  withSessionStorage((values) => {
    storeTabStudentToken("ABC123", "guest-token", null);
    values.set("student-session:ABC123", "legacy-token");
    values.set("student-session:OTHER1", "other-code-token");

    storeTabStudentToken("ABC123", "account-a-token", "account-a");

    assert.equal(readTabStudentToken("ABC123", "account-a"), "account-a-token");
    assert.equal(readTabStudentToken("ABC123", null), null);
    assert.equal(values.has("student-session:ABC123"), false);
    assert.equal(values.get("student-session:OTHER1"), "other-code-token");
  });
});
