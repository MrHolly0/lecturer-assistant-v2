import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, apiErrorFromResponse, parseRetryAfter } from "./errors.ts";
import {
  isRetryableError,
  mutationRetryDelay,
  retryDelayMs,
  shouldRetryMutation,
  shouldRetryRead
} from "./retry.ts";

test("Retry-After seconds and HTTP dates survive both JSON and proxy errors", async () => {
  const now = Date.parse("2026-10-23T10:00:00Z");
  assert.equal(parseRetryAfter("60", now), 60000);
  assert.equal(parseRetryAfter("Fri, 23 Oct 2026 10:01:00 GMT", now), 60000);
  assert.equal(parseRetryAfter("Fri, 23 Oct 2026 09:59:00 GMT", now), 0);
  assert.equal(parseRetryAfter("not-a-date", now), undefined);
  assert.equal(parseRetryAfter(null, now), undefined);
  for (const body of ['{"error":"RATE_LIMITED"}', "<html>Too many requests</html>"]) {
    const error = await apiErrorFromResponse(
      new Response(body, { status: 429, headers: { "Retry-After": "60" } })
    );
    assert.equal(error.retryAfterMs, 60000);
    assert.equal(error.status, 429);
  }
});

test("exponential jitter grows within a cap and never shortens Retry-After", () => {
  assert.equal(retryDelayMs(0, { random: () => 0 }), 300);
  assert.equal(retryDelayMs(1, { random: () => 1 }), 1200);
  assert.equal(retryDelayMs(1000, { random: () => 1 }), 30000);
  const error = new ApiError(429, "wait", undefined, undefined, 60000);
  const low = retryDelayMs(0, { error, random: () => 0 });
  const high = retryDelayMs(0, { error, random: () => 1 });
  assert.equal(low, 60000);
  assert.ok(high > low);
  assert.ok(mutationRetryDelay(0, error) >= 60000);
});

test("read and explicitly idempotent mutation retry budgets exclude validation and cancellation", () => {
  for (const error of [
    new ApiError(408, "timeout"),
    new ApiError(429, "limit"),
    new ApiError(503, "down"),
    new TypeError("fetch failed"),
    new DOMException("timeout", "TimeoutError")
  ]) {
    assert.equal(isRetryableError(error), true);
    assert.equal(shouldRetryRead(0, error), true);
    assert.equal(shouldRetryMutation(1, error), true);
    assert.equal(shouldRetryRead(2, error), false);
    assert.equal(shouldRetryMutation(2, error), false);
  }
  for (const error of [
    new ApiError(400, "invalid"),
    new ApiError(401, "expired"),
    new ApiError(403, "forbidden"),
    new ApiError(409, "conflict"),
    new Error("programming error"),
    new DOMException("cancel", "AbortError")
  ]) {
    assert.equal(isRetryableError(error), false);
    assert.equal(shouldRetryMutation(0, error), false);
    assert.equal(shouldRetryRead(0, error), false);
  }
});
