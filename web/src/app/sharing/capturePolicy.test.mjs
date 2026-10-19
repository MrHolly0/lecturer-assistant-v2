import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCaptureSurface, captureOptions } from "./capturePolicy.ts";
test("window and tab capture are allowed before separate teacher confirmation", () => {
  assert.equal(validateCaptureSurface({ displaySurface: "window" }), null);
  assert.equal(validateCaptureSurface({ displaySurface: "browser" }), null);
});
test("monitor and unverifiable capture are rejected before publishing private UI", () => {
  assert.ok(validateCaptureSurface({ displaySurface: "monitor" }));
  assert.ok(validateCaptureSurface({}));
  assert.equal(captureOptions.monitorTypeSurfaces, "exclude");
  assert.equal(captureOptions.selfBrowserSurface, "exclude");
  assert.equal(captureOptions.surfaceSwitching, "exclude");
  assert.equal(captureOptions.audio, false);
});
