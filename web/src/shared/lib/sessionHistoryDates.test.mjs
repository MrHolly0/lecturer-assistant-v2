import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function boundaries(timeZone, day) {
  const moduleUrl = new URL("./sessionHistoryDates.ts", import.meta.url).href;
  const script = `import { localDayBoundary } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify([localDayBoundary(${JSON.stringify(day)}), localDayBoundary(${JSON.stringify(day)}, true)]));`;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    {
      env: { ...process.env, TZ: timeZone },
      encoding: "utf8"
    }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Moscow end date includes the full local day and rolls into the next month", () => {
  assert.deepEqual(boundaries("Europe/Moscow", "2026-10-31"), [
    "2026-10-30T21:00:00.000Z",
    "2026-10-31T21:00:00.000Z"
  ]);
});
test("Berlin spring DST day is 23 hours", () => {
  assert.deepEqual(boundaries("Europe/Berlin", "2026-03-29"), [
    "2026-03-28T23:00:00.000Z",
    "2026-03-29T22:00:00.000Z"
  ]);
});
test("Berlin autumn DST day is 25 hours", () => {
  assert.deepEqual(boundaries("Europe/Berlin", "2026-10-25"), [
    "2026-10-24T22:00:00.000Z",
    "2026-10-25T23:00:00.000Z"
  ]);
});
test("Santiago midnight DST does not include the first hour of the following date", () => {
  assert.deepEqual(boundaries("America/Santiago", "2026-09-06"), [
    "2026-09-06T04:00:00.000Z",
    "2026-09-07T03:00:00.000Z"
  ]);
});
test("invalid calendar dates do not silently normalize into another month", () => {
  assert.deepEqual(boundaries("Europe/Moscow", "2026-02-29"), [null, null]);
  assert.deepEqual(boundaries("Europe/Moscow", "2026-13-01"), [null, null]);
  assert.deepEqual(boundaries("Europe/Moscow", "0000-01-01"), [null, null]);
});
