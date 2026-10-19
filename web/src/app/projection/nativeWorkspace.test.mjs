import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeCapture } from "./nativeWorkspace.ts";

test("macOS native capture distinguishes the protected display picker and recovers from denial", async () => {
  const previousWindow = globalThis.window;
  const commands = [];
  const host = new EventTarget();
  host.lectureProjectorNative = {
    platform: "MACOS",
    nativeCapture: true,
    captureModes: { window: true, application: true, protectedDisplay: true },
    postMessage: (message) => commands.push(message)
  };
  globalThis.window = host;
  const detach = nativeCapture.subscribe(() => {});
  const scope = {
    courseId: "course-1",
    sessionId: "session-1",
    joinCode: "ABC123"
  };
  const emit = (detail) => {
    const event = new Event("lecture-projector-native");
    event.detail = detail;
    host.dispatchEvent(event);
  };

  try {
    await nativeCapture.choose(scope, "window");
    await nativeCapture.choose(scope, "display");
    emit({ type: "capture-state", phase: "idle" });
    assert.equal(nativeCapture.getSnapshot().phase, "choosing");
    assert.deepEqual(nativeCapture.getSnapshot().scope, scope);
    assert.equal(nativeCapture.getSnapshot().permissionPending, true);
    emit({ type: "capture-state", phase: "permission" });
    assert.deepEqual(
      commands
        .filter(
          (message) => message.action === "chooseSource" || message.action === "chooseDisplay"
        )
        .map((message) => message.action),
      ["chooseSource", "chooseDisplay"]
    );
    assert.equal(nativeCapture.getSnapshot().permissionPending, true);

    emit({ type: "error", code: "SCREEN_RECORDING_PERMISSION_REQUIRED" });
    assert.equal(nativeCapture.getSnapshot().permissionDenied, true);
    assert.match(nativeCapture.getSnapshot().error, /Выберите окно или приложение/);

    await nativeCapture.choose(scope, "window");
    assert.equal(nativeCapture.getSnapshot().permissionDenied, false);
    emit({
      type: "preview",
      sourceName: "Учебные материалы",
      sourceKind: "application",
      captureExcludesRemote: true
    });
    assert.equal(nativeCapture.getSnapshot().sourceName, "Учебные материалы");
    assert.deepEqual(nativeCapture.getSnapshot().scope, scope);
    assert.equal(nativeCapture.getSnapshot().sourceKind, "application");
    assert.equal(nativeCapture.getSnapshot().surface, "window");
    assert.equal(nativeCapture.getSnapshot().captureExcludesRemote, true);

    emit({ type: "preview", sourceName: "Весь экран", sourceKind: "display" });
    assert.equal(nativeCapture.getSnapshot().surface, "monitor");

    emit({ type: "capture-state", phase: "idle" });
    assert.equal(nativeCapture.getSnapshot().phase, "idle");
    assert.equal(nativeCapture.getSnapshot().scope, null);
    assert.equal(nativeCapture.getSnapshot().sourceName, "");

    await nativeCapture.choose(scope, "window");
    emit({ type: "capture-state", phase: "choosing" });
    emit({ type: "capture-state", phase: "idle" });
    assert.equal(nativeCapture.getSnapshot().phase, "idle");
    assert.equal(nativeCapture.getSnapshot().scope, null);

    host.lectureProjectorNative.captureModes = undefined;
    emit({ type: "error", code: "SCREEN_RECORDING_PERMISSION_REQUIRED" });
    assert.doesNotMatch(nativeCapture.getSnapshot().error, /повторно выдавать разрешение не нужно/);
  } finally {
    detach();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
