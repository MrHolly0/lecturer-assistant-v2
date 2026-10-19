import assert from "node:assert/strict";
import { test } from "node:test";
import { helperShowAcknowledged, reconcileHelperWizardStep } from "./helperWizardState.ts";

const session = { sessionId: "session-1", active: true };
const screens = [{ id: "screen-1" }, { id: "screen-2" }];
const showing = {
  connected: true,
  activeSessionId: "session-1",
  status: "SHOWING",
  screens
};

test("authoritative helper status restores manage only for the current active session", () => {
  assert.equal(reconcileHelperWizardStep("prepare", showing, session), "manage");
  assert.equal(
    reconcileHelperWizardStep(
      "manage",
      { ...showing, activeSessionId: "another-session" },
      session
    ),
    "identify"
  );
  assert.equal(
    reconcileHelperWizardStep("manage", showing, { ...session, active: false }),
    "prepare"
  );
});

test("helper restart from showing to idle clears stale management and stop stages", () => {
  const idle = { ...showing, status: "IDLE" };
  for (const staleStep of ["manage", "stopped"]) {
    assert.equal(reconcileHelperWizardStep(staleStep, idle, session), "identify");
  }
  assert.equal(reconcileHelperWizardStep("waiting", idle, session), null);
  assert.equal(reconcileHelperWizardStep("manage", { ...idle, screens: [] }, session), "prepare");
});

test("a pending physical code check remains available while the helper reports TESTING", () => {
  assert.equal(
    reconcileHelperWizardStep("confirm", { ...showing, status: "TESTING" }, session),
    null
  );
  assert.equal(
    reconcileHelperWizardStep("confirm", { ...showing, connected: false }, session),
    "prepare"
  );
});

test("disconnect exits stale manage actions and preserves ordinary setup progress", () => {
  assert.equal(
    reconcileHelperWizardStep("manage", { ...showing, connected: false }, session),
    "prepare"
  );
  assert.equal(
    reconcileHelperWizardStep("identify", { ...showing, connected: false }, session),
    null
  );
});

test("the explicit stopped state waits for the helper snapshot instead of reopening controls", () => {
  assert.equal(reconcileHelperWizardStep("stopped", showing, session), null);
  assert.equal(
    reconcileHelperWizardStep("stopped", { ...showing, status: "IDLE" }, session),
    "identify"
  );
});

test("queued start ignores stale TESTING and IDLE snapshots until a fresh SHOWING heartbeat arrives", () => {
  const requestTime = Date.parse("2026-10-19T10:00:00.000Z");
  for (const status of ["TESTING", "IDLE", "SHOWING"]) {
    const stale = {
      ...showing,
      status,
      lastSeenAt: "2026-10-19T09:59:59.000Z"
    };
    assert.equal(reconcileHelperWizardStep("waiting", stale, session), null);
    assert.equal(helperShowAcknowledged(requestTime, stale, session), false);
  }

  const freshShowing = {
    ...showing,
    lastSeenAt: "2026-10-19T10:00:01.000Z"
  };
  assert.equal(reconcileHelperWizardStep("waiting", freshShowing, session), null);
  assert.equal(helperShowAcknowledged(requestTime, freshShowing, session), true);
  assert.equal(
    reconcileHelperWizardStep("waiting", { ...showing, connected: false }, session),
    "prepare"
  );
});
