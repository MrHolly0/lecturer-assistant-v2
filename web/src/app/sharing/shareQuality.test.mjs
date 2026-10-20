import assert from "node:assert/strict";
import { test } from "node:test";
import { captureOptions } from "./capturePolicy.ts";
import { configureScreenSenders, shareDimensions, shareVideoBitrate } from "./shareQuality.ts";

test("capture keeps source pixels and transport accepts landscape and portrait 4K", () => {
  assert.equal(captureOptions.video.width, undefined);
  assert.equal(captureOptions.video.height, undefined);
  assert.deepEqual(shareDimensions(2560, 1440), { width: 2560, height: 1440 });
  assert.deepEqual(shareDimensions(3840, 2160), { width: 3840, height: 2160 });
  assert.deepEqual(shareDimensions(2160, 3840), { width: 2160, height: 3840 });
  assert.deepEqual(shareDimensions(7680, 4320), { width: 3840, height: 2160 });
  const square = shareDimensions(4000, 4000);
  assert.ok(square.width * square.height <= 3840 * 2160);
  assert.deepEqual(shareDimensions(NaN, 0), { width: 1920, height: 1080 });
  assert.ok(shareVideoBitrate(3840, 2160) > shareVideoBitrate(1920, 1080));
});

test("WebRTC preserves pixel detail, packet parameters, and gives a local projector more headroom", async () => {
  async function configure(local) {
    const calls = [];
    const sender = {
      track: { kind: "video", getSettings: () => ({ width: 2560, height: 1440 }) },
      getParameters: () => ({ transactionId: "existing", encodings: [{ active: true, rid: "original" }] }),
      setParameters: async (parameters) => { calls.push(parameters); }
    };
    await configureScreenSenders({ getSenders: () => [sender] }, local);
    return calls[0];
  }
  const remote = await configure(false), local = await configure(true);
  assert.equal(remote.degradationPreference, "maintain-resolution");
  assert.equal(remote.encodings[0].scaleResolutionDownBy, 1);
  assert.equal(remote.encodings[0].rid, "original");
  assert.equal(remote.transactionId, "existing");
  assert.ok(local.encodings[0].maxBitrate > remote.encodings[0].maxBitrate);
});

test("engines rejecting degradation preference retry portable limits without breaking sharing", async () => {
  const calls = [];
  const sender = {
    track: { kind: "video", getSettings: () => ({ width: 1920, height: 1080 }) },
    getParameters: () => ({ encodings: [{}] }),
    setParameters: async (parameters) => {
      calls.push(parameters);
      if (parameters.degradationPreference) throw new Error("unsupported");
    }
  };
  await configureScreenSenders({ getSenders: () => [sender] }, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].degradationPreference, undefined);
  assert.equal(calls[1].encodings[0].scaleResolutionDownBy, 1);
  assert.ok(calls[1].encodings[0].maxBitrate >= 8_000_000);
  await configureScreenSenders({ getSenders: () => [{ ...sender, setParameters: async () => { throw new Error("unsupported"); } }] }, true);
});
