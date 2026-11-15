import assert from "node:assert/strict";
import { test } from "node:test";
import { captureMessengerLaunch } from "./launch-data.ts";

test("Telegram signed launch is captured once and stripped before app navigation", () => {
  const signed = "auth_date=123&user=%7B%22id%22%3A7%7D&hash=test-fixture";
  const result = captureMessengerLaunch(
    `https://example.test/?keep=1#tgWebAppData=${encodeURIComponent(signed)}&tgWebAppVersion=8.0`
  );
  assert.deepEqual(result.launch, { channel: "telegram", initData: signed });
  assert.equal(result.cleanUrl, "https://example.test/?keep=1");
});
test("VK capture preserves duplicate signed fields for server rejection and excludes unsigned identity", () => {
  const result = captureMessengerLaunch(
    "https://example.test/?vk_app_id=9&vk_user_id=7&vk_user_id=8&sign=fixture&user_id=99#/home"
  );
  assert.equal(result.launch.channel, "vk");
  assert.deepEqual(new URLSearchParams(result.launch.initData).getAll("vk_user_id"), ["7", "8"]);
  assert.equal(new URLSearchParams(result.launch.initData).get("user_id"), null);
  assert.equal(result.cleanUrl, "https://example.test/?user_id=99#/home");
});
test("ordinary browser/MAX routes stay intact and unsigned VK is not a login", () => {
  for (const url of [
    "https://example.test/#/s/ABC123",
    "https://example.test/?WebAppData=max-fixture#/home",
    "https://example.test/?vk_app_id=9#/home"
  ]) {
    assert.equal(captureMessengerLaunch(url).launch, null);
  }
  assert.equal(
    captureMessengerLaunch("https://example.test/#/s/ABC123").cleanUrl,
    "https://example.test/#/s/ABC123"
  );
});
