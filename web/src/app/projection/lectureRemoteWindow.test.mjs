import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = stripTypeScriptTypes(
  await readFile(new URL("./lectureRemoteWindow.ts", import.meta.url), "utf8")
);
function popup() {
  return Object.assign(new EventTarget(), {
    closed: false,
    focus() {},
    document: {
      title: "",
      documentElement: { lang: "" },
      body: {
        children: [{}],
        classList: { add() {} }
      }
    }
  });
}
async function fixture(host) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: host, configurable: true });
  const api = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${crypto.randomUUID()}`
  );
  return {
    ...api,
    restore() {
      if (original) Object.defineProperty(globalThis, "window", original);
      else delete globalThis.window;
    }
  };
}

test("popup opening happens in the initiating call and a closed lifecycle can open again", async () => {
  const calls = [];
  const target = popup();
  const api = await fixture({
    open(...args) {
      calls.push(args);
      return target;
    }
  });
  try {
    const opening = api.openLectureRemoteWindow({ windowKey: "session" });
    assert.equal(calls.length, 1, "window.open must precede any async continuation");
    assert.equal(await opening, target);
    assert.match(calls[0][2], /popup=yes,resizable=yes/);
    assert.equal(target.document.title, "Lecturer Assistant · Пульт");
    assert.equal(api.lectureRemoteWindowMode(target), "popup");
    assert.equal(await api.openLectureRemoteWindow({ windowKey: "session" }), target);
    assert.equal(calls.length, 1, "repeated click focuses the existing remote");
    target.dispatchEvent(new Event("pagehide"));
    await api.openLectureRemoteWindow({ windowKey: "session", collapsed: true });
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0][1], calls[1][1], "never navigate an unrelated named window");
    assert.match(calls[1][2], /width=264,height=96/);
  } finally {
    api.restore();
  }
});

test("Document PiP starts synchronously and repeated clicks share its pending request", async () => {
  const target = popup();
  let calls = 0;
  let resolve;
  const api = await fixture({
    documentPictureInPicture: {
      requestWindow() {
        calls++;
        return new Promise((done) => {
          resolve = done;
        });
      }
    }
  });
  try {
    const opening = api.openLectureRemoteWindow({ windowKey: "session" });
    assert.equal(calls, 1);
    assert.equal(api.openLectureRemoteWindow({ windowKey: "session" }), opening);
    resolve(target);
    assert.equal(await opening, target);
    assert.equal(api.lectureRemoteWindowMode(target), "pip");
  } finally {
    api.restore();
  }
});

test("denied or synchronously failing PiP offers a fresh ordinary-popup click", async () => {
  for (const synchronous of [false, true]) {
    let opens = 0;
    const target = popup();
    const api = await fixture({
      documentPictureInPicture: {
        requestWindow() {
          if (synchronous) throw new DOMException("Blocked", "NotAllowedError");
          return Promise.reject(new DOMException("Blocked", "NotAllowedError"));
        }
      },
      open() {
        opens++;
        return target;
      }
    });
    try {
      let opening;
      assert.doesNotThrow(() => {
        opening = api.openLectureRemoteWindow();
      });
      await assert.rejects(opening, /Нажмите «Вынести пульт» ещё раз/);
      assert.equal(opens, 0, "denied async PiP must not attempt a blocked async popup");
      assert.equal(api.supportsPinnedLectureRemote(), false);
      assert.equal(await api.openLectureRemoteWindow(), target);
      assert.equal(opens, 1);
    } finally {
      api.restore();
    }
  }
});

test("a blocked or synchronously failing popup rejects without throwing at its caller", async () => {
  for (const synchronous of [false, true]) {
    const api = await fixture({
      open() {
        if (synchronous) throw new DOMException("Blocked", "SecurityError");
        return null;
      }
    });
    try {
      let opening;
      assert.doesNotThrow(() => {
        opening = api.openLectureRemoteWindow();
      });
      await assert.rejects(opening, /Разрешите всплывающие окна/);
    } finally {
      api.restore();
    }
  }
});
