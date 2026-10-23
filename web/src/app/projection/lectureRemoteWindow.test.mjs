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
    api.rememberLectureRemoteCollapsed("session", true);
    await api.openLectureRemoteWindow({ windowKey: "session" });
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0][1], calls[1][1], "never navigate an unrelated named window");
    assert.match(calls[1][2], /width=264,height=60/);
    assert.equal(api.lectureRemoteCollapsed("session"), true);
    assert.equal(api.lectureRemoteCollapsed("other-session"), false);
  } finally {
    api.restore();
  }
});

test("Document PiP starts synchronously and repeated clicks share its pending request", async () => {
  const target = popup();
  let calls = 0;
  let options;
  let resolve;
  const api = await fixture({
    documentPictureInPicture: {
      requestWindow(value) {
        options = value;
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
    assert.deepEqual(options, {
      width: 420,
      height: 640,
      disallowReturnToOpener: true,
      preferInitialWindowPlacement: true
    });
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

test("opening and refocusing request a stable size without resizing the opened window", async () => {
  const opens = [];
  const resizes = [];
  const target = Object.assign(popup(), { resizeTo: (...args) => resizes.push(args) });
  const api = await fixture({
    screen: { availWidth: 1440, availHeight: 900 },
    open(...args) {
      opens.push(args);
      return target;
    }
  });
  try {
    await api.openLectureRemoteWindow({ windowKey: "stable" });
    assert.match(opens[0][2], /width=420,height=640/);
    target.dispatchEvent(new Event("resize"));
    target.dispatchEvent(new Event("focus"));
    await api.openLectureRemoteWindow({ windowKey: "stable" });
    assert.equal(opens.length, 1);
    assert.deepEqual(resizes, []);
  } finally {
    api.restore();
  }
});

test("explicit compact and expanded actions resize independently of content and browser chrome", async () => {
  const resizes = [];
  const target = Object.assign(popup(), {
    innerWidth: 420,
    outerWidth: 436,
    innerHeight: 640,
    outerHeight: 678,
    screen: { availWidth: 1440, availHeight: 900 },
    resizeTo: (...args) => resizes.push(args)
  });
  const api = await fixture({});
  try {
    api.resizeLectureRemoteWindow(target, true);
    api.resizeLectureRemoteWindow(target, false);
    assert.deepEqual(resizes, [
      [280, 98],
      [436, 678]
    ]);
    // A smaller monitor only limits a later explicit resize, not the act of moving there.
    target.screen = { availWidth: 320, availHeight: 480 };
    target.dispatchEvent(new Event("resize"));
    assert.equal(resizes.length, 2);
    api.resizeLectureRemoteWindow(target, false);
    assert.deepEqual(resizes.at(-1), [312, 422]);
    target.closed = true;
    api.resizeLectureRemoteWindow(target, true);
    assert.equal(resizes.length, 3);
  } finally {
    api.restore();
  }
});

test("opening on a small work area is bounded and a refused explicit resize is harmless", async () => {
  const opens = [];
  const target = Object.assign(popup(), {
    resizeTo() {
      throw new DOMException("Gesture required", "NotAllowedError");
    }
  });
  const api = await fixture({
    screen: { availWidth: 320, availHeight: 480 },
    open(...args) {
      opens.push(args);
      return target;
    }
  });
  try {
    await api.openLectureRemoteWindow();
    assert.match(opens[0][2], /width=296,height=384/);
    assert.doesNotThrow(() => api.resizeLectureRemoteWindow(target, false));
  } finally {
    api.restore();
  }
});
