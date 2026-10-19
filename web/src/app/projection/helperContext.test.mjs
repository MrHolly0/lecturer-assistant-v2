import assert from "node:assert/strict";
import { test } from "node:test";
import { configureHelperContext, readHelperContext } from "./helperContext.ts";
import { apiFetch, ApiError } from "../api/http.ts";

const id = "11111111-1111-4111-8111-111111111111";
const token = `${id}.${"a".repeat(64)}`;
const route = `#/helper/remote?courseId=${id}&sessionId=${id}&controlToken=${token}`;

test("native context accepts only one exact lesson and a scoped device grant", () => {
  assert.deepEqual(readHelperContext(route), { courseId: id, sessionId: id, controlToken: token });
  for (const invalid of [
    route.replace("/helper/remote", "/courses"),
    `${route}&courseId=${id}`,
    `${route}&staffToken=teacher`,
    route.replace(token, "teacher-access-token"),
    route.replace(`courseId=${id}`, "courseId=../admin")
  ])
    assert.equal(readHelperContext(invalid), null);
});

test("native API requests omit browser credentials and never refresh a staff session", async () => {
  configureHelperContext(readHelperContext(route));
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ message: "Expired" }), { status: 401 });
  };
  try {
    await assert.rejects(
      apiFetch(`/courses/${id}/sessions/${id}`, {
        headers: { Authorization: "Bearer should-not-leak" },
        credentials: "include"
      }),
      (error) => error instanceof ApiError && error.status === 401
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].init.headers.has("Authorization"), false);
    assert.equal(requests[0].init.headers.get("X-Lecture-Control-Token"), token);
    assert.equal(requests[0].url.includes("/auth/refresh"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
