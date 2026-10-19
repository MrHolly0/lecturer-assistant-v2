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
  const scope = {
    courseId: "course-1",
    sessionId: "session-1",
    joinCode: "ABC123"
  };
  nativeCapture.registerScope(scope);
  const detach = nativeCapture.subscribe(() => {});
  const emit = (detail) => {
    const event = new Event("lecture-projector-native");
    event.detail = detail;
    host.dispatchEvent(event);
  };
  const latestReady = () => commands.findLast((message) => message.action === "ready");
  const snapshot = (syncId, phase, extra = {}) =>
    emit({
      type: "capture-snapshot",
      syncId,
      courseId: scope.courseId,
      sessionId: scope.sessionId,
      phase,
      ...extra
    });

  try {
    const liveRequestId = "10000000-0000-4000-8000-000000000001";
    const liveSyncId = latestReady().syncId;
    assert.match(liveSyncId, /^[0-9a-f-]{36}$/i);
    assert.notEqual(liveSyncId, liveRequestId);
    snapshot(liveSyncId, "live", {
      requestId: liveRequestId,
      captureMode: "system-window",
      sourceName: "Учебное окно",
      sourceKind: "window",
      captureExcludesRemote: true
    });
    assert.equal(nativeCapture.getSnapshot().phase, "publishing");
    assert.equal(nativeCapture.getSnapshot().requestId, liveRequestId);
    assert.deepEqual(nativeCapture.getSnapshot().scope, scope);
    emit({
      type: "capture-state",
      phase: "paused",
      requestId: liveRequestId,
      captureMode: "system-window"
    });
    assert.equal(nativeCapture.getSnapshot().phase, "publishing");
    assert.equal(nativeCapture.getSnapshot().paused, true);

    nativeCapture.refreshStatus();
    const pausedSyncId = latestReady().syncId;
    snapshot(pausedSyncId, "paused", {
      requestId: liveRequestId,
      captureMode: "system-window",
      sourceName: "Учебное окно",
      sourceKind: "window"
    });
    assert.equal(nativeCapture.getSnapshot().phase, "publishing");
    assert.equal(nativeCapture.getSnapshot().paused, true);

    nativeCapture.refreshStatus();
    const previewSyncId = latestReady().syncId;
    snapshot(previewSyncId, "preview", {
      requestId: liveRequestId,
      captureMode: "system-window",
      sourceName: "Материалы курса",
      sourceKind: "application",
      frameUrl: "data:image/jpeg;base64,/9j/2Q=="
    });
    assert.equal(nativeCapture.getSnapshot().phase, "preview");
    assert.equal(nativeCapture.getSnapshot().surface, "window");
    assert.equal(nativeCapture.getSnapshot().sourceKind, "application");
    assert.equal(nativeCapture.getSnapshot().previewFrame, "data:image/jpeg;base64,/9j/2Q==");

    await nativeCapture.choose(scope, "window");
    const applicationChoice = commands.findLast((message) => message.action === "chooseSource");
    nativeCapture.refreshStatus();
    snapshot(latestReady().syncId, "idle", {
      requestId: applicationChoice.requestId,
      captureMode: "system-window"
    });
    assert.equal(nativeCapture.getSnapshot().phase, "choosing");
    assert.equal(nativeCapture.getSnapshot().requestId, applicationChoice.requestId);
    emit({
      type: "capture-state",
      phase: "choosing",
      requestId: applicationChoice.requestId,
      captureMode: "system-window"
    });
    emit({
      type: "capture-state",
      phase: "preview",
      requestId: applicationChoice.requestId,
      captureMode: "system-window",
      sourceKind: "application",
      sourceName: "Учебные материалы",
      captureExcludesRemote: true
    });
    assert.equal(nativeCapture.getSnapshot().surface, "window");
    assert.equal(nativeCapture.getSnapshot().sourceKind, "application");
    assert.equal(nativeCapture.getSnapshot().sourceName, "Учебные материалы");
    emit({
      type: "preview",
      requestId: applicationChoice.requestId,
      frameUrl: "data:image/jpeg;base64,/9j/2Q=="
    });
    assert.equal(nativeCapture.getSnapshot().surface, "window");
    assert.equal(nativeCapture.getSnapshot().sourceKind, "application");

    nativeCapture.refreshStatus();
    const staleSyncId = latestReady().syncId;
    await nativeCapture.stop();
    snapshot(staleSyncId, "live", {
      requestId: liveRequestId,
      captureMode: "system-window",
      sourceName: "Устаревший показ",
      sourceKind: "window"
    });
    assert.equal(nativeCapture.getSnapshot().phase, "idle");
    nativeCapture.registerScope({ ...scope, courseId: "course-2", sessionId: "session-2" });
    const otherScopeSyncId = latestReady().syncId;
    snapshot(otherScopeSyncId, "live", {
      requestId: liveRequestId,
      captureMode: "system-window",
      sourceName: "Другая лекция",
      sourceKind: "window"
    });
    assert.equal(nativeCapture.getSnapshot().phase, "idle");
    nativeCapture.registerScope(scope);

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
      ["chooseSource", "chooseSource", "chooseDisplay"]
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
    await nativeCapture.choose(scope, "display");
    const legacyDisplayChoice = commands.findLast((message) => message.action === "chooseDisplay");
    emit({
      type: "error",
      code: "SCREEN_RECORDING_PERMISSION_REQUIRED",
      requestId: legacyDisplayChoice.requestId
    });
    assert.doesNotMatch(nativeCapture.getSnapshot().error, /повторно выдавать разрешение не нужно/);

    await nativeCapture.choose(scope, "window");
    emit({ type: "capture-state", phase: "choosing" });
    emit({ type: "capture-state", phase: "idle" });
    emit({ type: "error", message: "Системный выбор не завершился" });
    assert.equal(nativeCapture.getSnapshot().phase, "error");
    assert.equal(nativeCapture.getSnapshot().error, "Системный выбор не завершился");

    host.lectureProjectorNative.captureModes = {
      window: true,
      application: true,
      protectedDisplay: true,
      manualWindow: true
    };
    await nativeCapture.choose(scope, "window");
    const systemChoice = commands.findLast((message) => message.action === "chooseSource");
    assert.match(systemChoice.requestId, /^[0-9a-f-]{36}$/i);
    emit({
      type: "capture-state",
      phase: "choosing",
      captureMode: "system-window",
      requestId: systemChoice.requestId
    });

    await nativeCapture.choose(scope, "manual-window");
    const manualChoice = commands.findLast((message) => message.action === "chooseWindowFallback");
    assert.ok(manualChoice, "manual fallback must use its dedicated native action");
    assert.match(manualChoice.requestId, /^[0-9a-f-]{36}$/i);
    assert.notEqual(manualChoice.requestId, systemChoice.requestId);
    assert.equal(nativeCapture.getSnapshot().captureMode, "manual-window");
    assert.equal(nativeCapture.getSnapshot().permissionPending, true);

    emit({
      type: "preview",
      captureMode: "system-window",
      requestId: systemChoice.requestId,
      sourceName: "late system-picker frame"
    });
    assert.equal(nativeCapture.getSnapshot().phase, "choosing");
    assert.notEqual(nativeCapture.getSnapshot().sourceName, "late system-picker frame");
    emit({
      type: "error",
      code: "CAPTURE_SYSTEM_PICKER_TIMED_OUT",
      captureMode: "system-window",
      requestId: systemChoice.requestId
    });
    assert.equal(nativeCapture.getSnapshot().phase, "choosing");
    assert.equal(nativeCapture.getSnapshot().errorCode, undefined);

    emit({
      type: "capture-state",
      phase: "permission",
      permissionPending: true,
      sourceKind: "window",
      captureMode: "manual-window",
      requestId: manualChoice.requestId
    });
    assert.equal(nativeCapture.getSnapshot().permissionPending, true);
    assert.equal(nativeCapture.getSnapshot().surface, "window");
    assert.equal(nativeCapture.getSnapshot().captureMode, "manual-window");
    emit({
      type: "preview",
      captureMode: "manual-window",
      requestId: manualChoice.requestId,
      sourceKind: "window",
      sourceName: "Учебное окно"
    });
    assert.equal(nativeCapture.getSnapshot().phase, "preview");
    assert.equal(nativeCapture.getSnapshot().sourceName, "Учебное окно");

    await nativeCapture.stop();
    emit({
      type: "preview",
      captureMode: "manual-window",
      requestId: manualChoice.requestId,
      sourceKind: "window",
      sourceName: "late frame after cancel"
    });
    assert.equal(nativeCapture.getSnapshot().phase, "idle");
    assert.equal(nativeCapture.getSnapshot().scope, null);
    assert.notEqual(nativeCapture.getSnapshot().sourceName, "late frame after cancel");

    await nativeCapture.choose(scope, "manual-window");
    const deniedManualChoice = commands.findLast(
      (message) => message.action === "chooseWindowFallback"
    );
    emit({
      type: "error",
      code: "CAPTURE_MANUAL_PERMISSION_REQUIRED",
      message: "Нет разрешения на запись окна",
      captureMode: "manual-window",
      requestId: deniedManualChoice.requestId
    });
    assert.equal(nativeCapture.getSnapshot().permissionDenied, false);
    assert.equal(nativeCapture.getSnapshot().error, "Нет разрешения на запись окна");
    assert.doesNotMatch(nativeCapture.getSnapshot().error, /захват всего экрана/);

    await nativeCapture.choose(scope, "window");
    const timedOutChoice = commands.findLast((message) => message.action === "chooseSource");
    emit({
      type: "error",
      code: "CAPTURE_SYSTEM_PICKER_TIMED_OUT",
      message: "fixture timeout",
      captureMode: "system-window",
      requestId: timedOutChoice.requestId
    });
    assert.equal(nativeCapture.getSnapshot().phase, "error");
    assert.equal(nativeCapture.getSnapshot().errorCode, "CAPTURE_SYSTEM_PICKER_TIMED_OUT");
    assert.match(nativeCapture.getSnapshot().error, /Повторите системный выбор/);

    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: { getRandomValues: (bytes) => bytes.fill(0x55) }
      });
      await nativeCapture.choose(scope, "manual-window");
      const fallbackChoice = commands.findLast(
        (message) => message.action === "chooseWindowFallback"
      );
      assert.match(
        fallbackChoice.requestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    } finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      else delete globalThis.crypto;
    }
  } finally {
    await nativeCapture.stop();
    detach();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
