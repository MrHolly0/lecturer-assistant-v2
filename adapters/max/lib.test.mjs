// Юнит-тесты чистой логики адаптера MAX. Без сети, без токена: node --test lib.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRateLimiter,
  extractJoinCode,
  extractSenderId,
  openAppButton,
  parseStartCommand,
  renderKeyboard,
  timingSafeEqualStrings,
  webhookPathFor,
} from "./lib.mjs";

test("extractJoinCode accepts the CodeGenerator alphabet", () => {
  assert.equal(extractJoinCode("ABC234"), "ABC234");
  assert.equal(extractJoinCode("  ABC234  "), "ABC234");
});

test("extractJoinCode rejects empty, non-string, or out-of-alphabet payload", () => {
  assert.equal(extractJoinCode(undefined), undefined);
  assert.equal(extractJoinCode(""), undefined);
  assert.equal(extractJoinCode("код с кириллицей"), undefined);
  assert.equal(extractJoinCode("has space"), undefined);
  assert.equal(extractJoinCode("a".repeat(65)), undefined);
});

test("openAppButton embeds the join code in the documented ?startapp= deep link", () => {
  const button = openAppButton("https://app.example/mini", "Открыть", "ABC234");
  assert.equal(button.type, "open_app");
  assert.equal(button.web_app, "https://app.example/mini?startapp=ABC234");
  assert.equal(button.payload, "ABC234");
});

test("openAppButton without a join code just opens the mini app", () => {
  const button = openAppButton("https://app.example/mini", "Открыть");
  assert.equal(button.web_app, "https://app.example/mini");
  assert.equal("payload" in button, false);
});

test("openAppButton URL-encodes an unusual join code", () => {
  const button = openAppButton("https://app.example/mini", "Открыть", "a b");
  assert.equal(button.web_app, "https://app.example/mini?startapp=a%20b");
});

test("parseStartCommand recognizes /start with and without a payload", () => {
  assert.deepEqual(parseStartCommand("/start ABC234"), { joinCode: "ABC234" });
  assert.deepEqual(parseStartCommand("/start"), { joinCode: undefined });
  assert.deepEqual(parseStartCommand("/start@my_bot ABC234"), { joinCode: "ABC234" });
  assert.equal(parseStartCommand("привет"), undefined);
  assert.equal(parseStartCommand(""), undefined);
});

test("extractSenderId tries the documented and best-effort fields in order", () => {
  assert.equal(extractSenderId({ message: { sender: { user_id: 1 } } }), 1);
  assert.equal(extractSenderId({ message: { sender: { id: 2 } } }), 2);
  assert.equal(extractSenderId({ message: { from: { id: 3 } } }), 3);
  assert.equal(extractSenderId({ message: { user: { id: 4 } } }), 4);
  assert.equal(extractSenderId({ message: {} }), undefined);
  assert.equal(extractSenderId({}), undefined);
});

test("timingSafeEqualStrings compares equal-length secrets and rejects mismatches", () => {
  assert.equal(timingSafeEqualStrings("secret", "secret"), true);
  assert.equal(timingSafeEqualStrings("secret", "wrong!"), false);
});

test("timingSafeEqualStrings never throws on length mismatch, missing header, or non-strings", () => {
  assert.equal(timingSafeEqualStrings("secret", "short"), false);
  assert.equal(timingSafeEqualStrings("", "secret"), false);
  assert.equal(timingSafeEqualStrings(undefined, "secret"), false);
  assert.equal(timingSafeEqualStrings(null, "secret"), false);
});

test("webhookPathFor is stable for the same token and does not leak it in cleartext", () => {
  const path = webhookPathFor("test-bot-token");
  assert.match(path, /^\/webhook\/[0-9a-f]{64}$/);
  assert.equal(path, webhookPathFor("test-bot-token"));
  assert.notEqual(path.includes("test-bot-token"), true);
});

test("renderKeyboard maps core's {text,payload} rows to MAX callback buttons", () => {
  const rendered = renderKeyboard([
    [{ text: "Да", payload: "yes" }, { text: "Нет", payload: "no" }],
  ]);
  assert.deepEqual(rendered, [
    [
      { type: "callback", text: "Да", payload: "yes" },
      { type: "callback", text: "Нет", payload: "no" },
    ],
  ]);
});

test("renderKeyboard returns undefined for an empty or missing keyboard", () => {
  assert.equal(renderKeyboard([]), undefined);
  assert.equal(renderKeyboard(undefined), undefined);
});

test("createRateLimiter spaces slots at least 1000/rps ms apart", () => {
  let now = 0;
  const reserveSlot = createRateLimiter(10, () => now); // 100ms per slot

  assert.equal(reserveSlot(), 0); // первый слот свободен сразу
  assert.equal(reserveSlot(), 100); // второй слот — через 100 мс от первого
  now = 250; // время ушло вперёд само по себе
  assert.equal(reserveSlot(), 0); // слот уже наступил, ждать не нужно
  assert.equal(reserveSlot(), 100); // а следующий — ровно через 100 мс от предыдущего
});
