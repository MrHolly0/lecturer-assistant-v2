import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { displayId } from "./setupState.ts";

// Compile the actual browser module to isolate its singleton and platform per test.
const source = (await readFile(new URL("./browserProjection.ts", import.meta.url), "utf8")).replace(
  'from "./setupState"',
  `from ${JSON.stringify(new URL("./setupState.ts", import.meta.url).href)}`
);
const moduleSource = stripTypeScriptTypes(source);
const geometry = (left, width = 1920) =>
  Object.assign(new EventTarget(), {
    left,
    top: 0,
    width,
    height: 1080,
    availLeft: left,
    availTop: 0,
    availWidth: width,
    availHeight: 1040,
    label: "Display"
  });
async function fixture({ api = true, deny = false, blocked = false } = {}) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const working = geometry(0),
    hdmi = geometry(-1920);
  const details = Object.assign(new EventTarget(), {
    screens: [working, hdmi],
    currentScreen: working
  });
  const permission = Object.assign(new EventTarget(), { state: "granted" });
  const sent = [];
  const popup = {
    closed: false,
    postMessage: (data) => sent.push(data),
    moveTo() {},
    resizeTo() {},
    close() {
      this.closed = true;
    }
  };
  const host = Object.assign(new EventTarget(), {
    isSecureContext: true,
    location: { origin: "https://class.example", pathname: "/" },
    open: () => (blocked ? null : popup)
  });
  if (api)
    host.getScreenDetails = async () => {
      if (deny) throw new DOMException("denied", "NotAllowedError");
      return details;
    };
  Object.defineProperty(globalThis, "window", { value: host, configurable: true });
  Object.defineProperty(globalThis, "navigator", {
    value: { permissions: { query: async () => permission } },
    configurable: true
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { setItem() {} },
    configurable: true
  });
  const { browserProjection: controller } = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}#${crypto.randomUUID()}`
  );
  const message = (data, { origin = host.location.origin, sender = popup } = {}) => {
    const event = new Event("message");
    Object.assign(event, { data, origin, source: sender });
    host.dispatchEvent(event);
  };
  const position = (overrides = {}, senderOptions) =>
    message(
      {
        protocol: "la-projector-v1",
        attemptId: controller.getSnapshot().attemptId,
        type: "position",
        screenId: displayId(hdmi),
        fullscreen: false,
        ...overrides
      },
      senderOptions
    );
  const restore = () => {
    controller.stop();
    for (const [key, descriptor] of [
      ["window", originalWindow],
      ["navigator", originalNavigator],
      ["localStorage", originalStorage]
    ]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
  return { controller, details, working, hdmi, permission, popup, sent, position, restore };
}

test("unsupported API, denied permission and blocked popup are distinct states", async () => {
  for (const [options, phase] of [
    [{ api: false }, "unsupported"],
    [{ deny: true }, "permission-denied"],
    [{ blocked: true }, "popup-blocked"]
  ]) {
    const t = await fixture(options);
    try {
      await t.controller.requestScreens();
      if (options.blocked) t.controller.openTest(displayId(t.hdmi), "ABC123");
      assert.equal(t.controller.getSnapshot().phase, phase);
      assert.equal(t.controller.confirmTest(), false);
    } finally {
      t.restore();
    }
  }
});

test("only the exact popup, origin and attempt can attest placement; a user confirmation remains necessary", async () => {
  const t = await fixture();
  try {
    await t.controller.requestScreens();
    t.controller.openTest(displayId(t.hdmi), "ABC123");
    for (const [data, sender] of [
      [{}, { origin: "https://other.example" }],
      [{ attemptId: "old-attempt" }],
      [{}, { sender: {} }]
    ]) {
      t.position(data, sender);
      assert.equal(t.controller.getSnapshot().phase, "opening");
      assert.equal(t.controller.confirmTest(), false);
    }
    t.position();
    assert.equal(t.controller.getSnapshot().phase, "testing");
    assert.equal(
      t.sent.some((item) => item.type === "show"),
      false
    );
    assert.equal(t.controller.confirmTest(), true);
    assert.equal(t.controller.getSnapshot().phase, "showing");
    assert.equal(t.sent.at(-1).type, "show");
    t.position();
    assert.equal(
      t.sent.at(-1).type,
      "lease",
      "receiver position renews the lease without a controller timer tick"
    );
    assert.equal(Object.keys(t.sent.at(-1)).sort().join(","), "attemptId,protocol,type");
  } finally {
    t.restore();
  }
});

test("topology changes and moving the receiver neutralize the public material and revoke confirmation", async () => {
  for (const change of ["receiver", "topology", "controller", "permission"]) {
    const t = await fixture();
    try {
      await t.controller.requestScreens();
      t.controller.openTest(displayId(t.hdmi), "ABC123");
      t.position();
      assert.equal(t.controller.confirmTest(), true);
      if (change === "receiver") t.position({ screenId: displayId(t.working) });
      if (change === "topology") {
        t.details.screens = [t.working];
        t.details.dispatchEvent(new Event("screenschange"));
      }
      if (change === "controller") {
        t.details.currentScreen = t.hdmi;
        t.details.dispatchEvent(new Event("currentscreenchange"));
      }
      if (change === "permission") {
        t.permission.state = "denied";
        t.permission.dispatchEvent(new Event("change"));
      }
      assert.notEqual(t.controller.getSnapshot().phase, "showing");
      assert.equal(t.controller.getSnapshot().placementVerified, false);
      assert.equal(t.controller.confirmTest(), false);
      assert.equal(t.sent.at(-1).type, "neutral");
    } finally {
      t.restore();
    }
  }
});

test("standalone setup checks placement without publishing any lecture", async () => {
  const t = await fixture();
  try {
    await t.controller.requestScreens();
    t.controller.openTest(displayId(t.hdmi), "setup");
    t.position();
    assert.equal(t.controller.confirmTest(), true);
    assert.equal(
      t.sent.some((item) => item.type === "show"),
      false
    );
    t.controller.stop();
    assert.equal(t.popup.closed, true);
    assert.equal(t.controller.getSnapshot().attemptId, null);
  } finally {
    t.restore();
  }
});
