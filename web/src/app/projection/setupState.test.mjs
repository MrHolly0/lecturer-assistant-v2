import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canConfirmProjection,
  displayId,
  initialProjectionSnapshot,
  isProjectionMessage,
  selectProjectionScreen,
  topologyId
} from "./setupState.ts";

const working = { left: 0, top: 0, width: 1440, height: 900 };
const hdmi = { left: -1920, top: 0, width: 1920, height: 1080 };
function fixture() {
  return {
    ...initialProjectionSnapshot,
    phase: "testing",
    selectedId: displayId(hdmi),
    attemptId: "a0c0921c-c580-4196-bf81-44bdc9e96bdd",
    placementVerified: true,
    screens: [
      { ...working, id: displayId(working), current: true, label: "Not a projector" },
      { ...hdmi, id: displayId(hdmi), current: false, label: "Built-in display" }
    ]
  };
}

test("physical confirmation needs a current placement attestation and an external target", () => {
  const state = fixture();
  assert.equal(canConfirmProjection(state), true);
  for (const patch of [
    { placementVerified: false },
    { phase: "opening" },
    { phase: "invalidated" },
    { phase: "popup-blocked" },
    { attemptId: null },
    { selectedId: displayId(working) },
    { screens: [] }
  ]) {
    assert.equal(canConfirmProjection({ ...state, ...patch }), false);
  }
});

test("selection never uses primary position, index, display name, or positive coordinates", () => {
  const state = fixture();
  assert.equal(selectProjectionScreen(state, displayId(working)), null);
  assert.equal(selectProjectionScreen(state, "missing"), null);
  assert.equal(selectProjectionScreen(state, displayId(hdmi))?.label, "Built-in display");
  assert.equal(
    selectProjectionScreen({ ...state, screens: state.screens.toReversed() }, displayId(hdmi))
      ?.left,
    -1920
  );
});

test("a topology fingerprint ignores enumeration order but invalidates resolution, removal and moving the controller", () => {
  const first = topologyId([working, hdmi], working);
  assert.equal(first, topologyId([hdmi, working], working));
  assert.notEqual(first, topologyId([working], working));
  assert.notEqual(first, topologyId([working, { ...hdmi, width: 1280 }], working));
  assert.notEqual(first, topologyId([working, hdmi], hdmi));
});

test("projection protocol rejects wrong attempts and unbounded or malformed placement data", () => {
  const attempt = "5ade417a-238b-4cc4-9220-d93ca21f8336";
  const valid = {
    protocol: "la-projector-v1",
    attemptId: attempt,
    type: "position",
    screenId: displayId(hdmi),
    fullscreen: false
  };
  assert.equal(isProjectionMessage(valid, attempt), true);
  for (const invalid of [
    null,
    "position",
    {},
    { ...valid, attemptId: "another-tab" },
    { ...valid, protocol: "other" },
    { ...valid, type: "exec" },
    { ...valid, screenId: "x".repeat(500) },
    { ...valid, fullscreen: "true" }
  ]) {
    assert.equal(isProjectionMessage(invalid, attempt), false);
  }
  for (const type of ["hello", "neutral", "show", "lease"])
    assert.equal(isProjectionMessage({ ...valid, type }, attempt), true);
});
