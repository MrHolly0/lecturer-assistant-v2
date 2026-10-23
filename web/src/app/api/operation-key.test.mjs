import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { PendingOperationKey } from "./operation-key.ts";
import { createQuestion, respondToPoll } from "./interaction-api.ts";
import { createLecture, uploadDeck } from "./content-api.ts";
import { askStudentQuestion, submitStudentSignal, submitStudentName } from "./student-api.ts";
import { getStoredAuth, setStoredAuth } from "../auth.ts";
import { invalidatePendingAuthRefresh } from "./refresh.ts";

const originals = Object.fromEntries(
  ["window", "navigator", "sessionStorage", "fetch", "CustomEvent", "XMLHttpRequest"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key)
  ])
);
let requests;
const response = (status, body = {}) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  requests = [];
  const values = new Map();
  for (const [key, value] of Object.entries({
    window: Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
    navigator: { locks: undefined },
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    },
    CustomEvent: class extends Event {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return response(200);
    }
  }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
});
afterEach(() => {
  invalidatePendingAuthRefresh();
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test("a logical draft retains its operation key after lost responses and rotates on change or success", async () => {
  const operation = new PendingOperationKey();
  const request = { text: "Question", questionType: "SHORT_ANSWER", options: [], tags: [] };
  const key = operation.forPayload({ courseId: "course", request });
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) throw new TypeError("response lost after commit");
    return response(200, { id: "saved-question" });
  };
  await assert.rejects(createQuestion("course", request, key), TypeError);
  assert.equal(requests.length, 1, "creating a question is not automatically replayed");
  const retried = await createQuestion(
    "course",
    request,
    operation.forPayload({ courseId: "course", request })
  );
  assert.equal(retried.id, "saved-question");
  assert.equal(new Headers(requests[0].init.headers).get("Idempotency-Key"), key);
  assert.equal(new Headers(requests[1].init.headers).get("Idempotency-Key"), key);
  assert.equal(requests[0].init.body, requests[1].init.body);
  operation.clear();
  assert.notEqual(operation.forPayload({ courseId: "course", request }), key);
  assert.notEqual(operation.forPayload({ courseId: "other-course", request }), key);
  assert.notEqual(
    operation.forPayload({ courseId: "course", request: { ...request, text: "Changed" } }),
    key
  );
});

test("an authenticated command replay after refresh keeps the same key and body", async () => {
  setStoredAuth({ accessToken: "old-token" });
  let commands = 0;
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/auth/refresh"))
      return response(200, { accessToken: "new-token", user: { id: "teacher" } });
    return response(++commands === 1 ? 401 : 200, { id: "lecture" });
  };
  await createLecture("course", "Lecture", "deck", "one-operation");
  const attempts = requests.filter((r) => r.url.endsWith("/lectures"));
  assert.equal(attempts.length, 2);
  assert.deepEqual(
    attempts.map((r) => new Headers(r.init.headers).get("Idempotency-Key")),
    ["one-operation", "one-operation"]
  );
  assert.equal(attempts[0].init.body, attempts[1].init.body);
  assert.equal(getStoredAuth().accessToken, "new-token");
});

test("guest writes identify the participant for quotas without changing payload authorization", async () => {
  await askStudentQuestion("JOIN", "guest-token", "Question", true, "question-operation");
  await submitStudentSignal("JOIN", "guest-token", "CLEAR", 1);
  await submitStudentName("JOIN", "guest-token", "Surname", "Name");
  await respondToPoll("JOIN", "poll", "guest-token", 1);
  for (const request of requests) {
    assert.equal(new Headers(request.init.headers).get("X-Participant-Token"), "guest-token");
    assert.equal(JSON.parse(request.init.body).participantToken, "guest-token");
    assert.equal(request.url.includes("guest-token"), false);
  }
  assert.equal(new Headers(requests[0].init.headers).get("Idempotency-Key"), "question-operation");
});

test("upload authentication recovery preserves its idempotency key and has a finite deadline", async () => {
  setStoredAuth({ accessToken: "old-token" });
  globalThis.fetch = async () =>
    response(200, { accessToken: "new-token", user: { id: "teacher" } });
  const uploads = [];
  class Upload {
    headers = new Headers();
    upload = {};
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers.set(name, value);
    }
    send(form) {
      this.form = form;
      uploads.push(this);
      this.status = uploads.length === 1 ? 401 : 202;
      this.response = { id: "one-job" };
      queueMicrotask(() => this.onload());
    }
  }
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: Upload
  });
  const result = await uploadDeck(
    "course",
    "Deck",
    new File(["bytes"], "slides.pdf"),
    () => {},
    "upload-operation"
  );
  assert.equal(result.id, "one-job");
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].form, uploads[1].form);
  for (const upload of uploads) {
    assert.equal(upload.headers.get("Idempotency-Key"), "upload-operation");
    assert.equal(upload.timeout, 300000);
  }
});

test("a late success cannot clear a newer operation key, and failed responses retain their key", async () => {
  const operation = new PendingOperationKey();
  let finishOld, finishNew;
  let oldKey, newKey;
  const old = operation.run({ text: "Old draft" }, (key) => {
    oldKey = key;
    return new Promise((resolve) => {
      finishOld = resolve;
    });
  });
  const current = operation.run({ text: "New draft" }, (key) => {
    newKey = key;
    return new Promise((resolve) => {
      finishNew = resolve;
    });
  });
  assert.notEqual(oldKey, newKey);
  finishOld("old response");
  assert.equal(await old, "old response");
  assert.equal(operation.forPayload({ text: "New draft" }), newKey);
  finishNew("new response");
  assert.equal(await current, "new response");
  assert.notEqual(operation.forPayload({ text: "New draft" }), newKey);
  let failedKey;
  await assert.rejects(
    operation.run({ text: "Retry draft" }, async (key) => {
      failedKey = key;
      throw new TypeError("response lost after commit");
    })
  );
  assert.equal(operation.forPayload({ text: "Retry draft" }), failedKey);
});
