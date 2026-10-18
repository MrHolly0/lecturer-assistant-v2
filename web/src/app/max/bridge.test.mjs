import test from "node:test";
import assert from "node:assert/strict";
import { readViewport } from "./bridge.ts";

async function withViewport(webApp, run) {
  const previous = globalThis.window;
  globalThis.window = {
    innerHeight: 844,
    innerWidth: 393,
    visualViewport: { height: 844, width: 393 },
    WebApp: webApp
  };
  try {
    await run();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

const app = (getViewportSize) => ({ initDataUnsafe: { query_id: "test" }, getViewportSize });

test("oversized MAX host dimensions cannot inflate the CSS viewport", async () => {
  await withViewport(
    app(async () => ({ height: "2556", width: "1179" })),
    async () => {
      assert.deepEqual(await readViewport(), { height: 844, width: 393 });
    }
  );
});

test("a smaller valid MAX content area is respected", async () => {
  await withViewport(
    app(async () => ({ height: "600", width: "390" })),
    async () => {
      assert.deepEqual(await readViewport(), { height: 600, width: 390 });
    }
  );
});

test("an asynchronous host reply is bounded against the current keyboard viewport", async () => {
  let resolve;
  const reply = new Promise((done) => {
    resolve = done;
  });
  await withViewport(
    app(() => reply),
    async () => {
      const pending = readViewport();
      window.visualViewport.height = 330;
      resolve({ height: "2556", width: "1179" });
      assert.deepEqual(await pending, { height: 330, width: 393 });
    }
  );
});

test("missing, malformed and failing host metrics use browser dimensions", async () => {
  for (const webApp of [
    undefined,
    app(async () => ({ height: "invalid", width: "-1" })),
    app(async () => {
      throw new Error("unavailable");
    })
  ]) {
    await withViewport(webApp, async () => {
      assert.deepEqual(await readViewport(), { height: 844, width: 393 });
    });
  }
});
