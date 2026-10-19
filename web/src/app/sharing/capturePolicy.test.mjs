import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCaptureSurface, captureOptions, captureSurface } from "./capturePolicy.ts";
test("window and tab capture are allowed before separate teacher confirmation", () => {
  assert.equal(validateCaptureSurface({ displaySurface: "window" }), null);
  assert.equal(validateCaptureSurface({ displaySurface: "browser" }), null);
});
test("monitor capture is offered, while missing metadata stays explicitly unknown", () => {
  assert.equal(validateCaptureSurface({ displaySurface: "monitor" }), null);
  assert.equal(validateCaptureSurface({}), null);
  assert.equal(captureSurface({ displaySurface: "monitor" }), "monitor");
  assert.equal(captureSurface({}), "unknown");
  assert.ok(validateCaptureSurface({ displaySurface: "invalid" }));
  assert.equal(captureOptions.monitorTypeSurfaces, "include");
  assert.equal(captureOptions.selfBrowserSurface, "exclude");
  assert.equal(captureOptions.surfaceSwitching, "exclude");
  assert.equal(captureOptions.audio, false);
});
