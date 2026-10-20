import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
const source = await readFile(new URL("./analytics-api.ts", import.meta.url), "utf8");
async function fixture(fetch) {
  globalThis.__analyticsFetch = fetch;
  const mock = `data:text/javascript,${encodeURIComponent("export const apiFetch=globalThis.__analyticsFetch")}#${Math.random()}`;
  return import(
    `data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source.replace('from "./http"', `from ${JSON.stringify(mock)}`)))}#${Math.random()}`
  );
}
test("student collection includes later API pages and passes group and cancellation", async () => {
  const data = Array.from({ length: 121 }, (_, i) => ({
    personId: String(i),
    displayName: i === 120 ? "Поздний студент" : `Студент ${i}`
  }));
  const requests = [],
    controller = new AbortController();
  const api = await fixture(async (url, options) => {
    const params = new URL(url, "http://local").searchParams;
    requests.push(params);
    assert.equal(options.signal, controller.signal);
    const offset = Number(params.get("offset"));
    return { json: async () => ({ total: data.length, items: data.slice(offset, offset + 100) }) };
  });
  const result = await api.listAllStudentAnalytics("course", "group", controller.signal);
  assert.equal(result.length, 121);
  assert.equal(result.find((item) => item.displayName === "Поздний студент").personId, "120");
  assert.deepEqual(
    requests.map((p) => p.get("offset")),
    ["0", "100"]
  );
  assert.ok(requests.every((p) => p.get("groupId") === "group"));
  delete globalThis.__analyticsFetch;
});
test("incomplete and cancelled requests do not masquerade as the full student list", async () => {
  let api = await fixture(async () => ({ json: async () => ({ total: 1, items: [] }) }));
  await assert.rejects(api.listAllStudentAnalytics("course", null), /полный список/);
  api = await fixture(async () => {
    throw new DOMException("Cancelled", "AbortError");
  });
  await assert.rejects(api.listAllStudentAnalytics("course", null), { name: "AbortError" });
  delete globalThis.__analyticsFetch;
});
