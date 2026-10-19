export type LectureRemoteWindowOptions = {
  windowKey?: string;
  collapsed?: boolean;
  mode?: "auto" | "popup";
};
type PictureInPictureHost = Window & {
  documentPictureInPicture?: {
    requestWindow: (options: { width: number; height: number }) => Promise<Window>;
  };
};
const windows = new Map<string, Window>();
const pending = new Map<string, Promise<Window>>();
const modes = new WeakMap<Window, "pip" | "popup">();
let pipRejected = false;
const pinFailure =
  "Не удалось закрепить пульт. Нажмите «Вынести пульт» ещё раз, чтобы открыть обычное отдельное окно.";
const popupFailure = "Разрешите всплывающие окна для сайта и нажмите «Вынести пульт» снова.";

export function supportsPinnedLectureRemote(): boolean {
  return (
    !pipRejected &&
    typeof (window as PictureInPictureHost).documentPictureInPicture?.requestWindow === "function"
  );
}

export function lectureRemoteWindowMode(target: Window): "pip" | "popup" | null {
  return modes.get(target) ?? null;
}

/** Call directly from a click, before awaiting requests or mounting the panel. */
export function openLectureRemoteWindow(options: LectureRemoteWindowOptions = {}): Promise<Window> {
  const key = options.windowKey ?? "default";
  const existing = windows.get(key);
  if (existing && !existing.closed) {
    existing.focus();
    return Promise.resolve(existing);
  }
  const opening = pending.get(key);
  if (opening) return opening;
  const size = { width: options.collapsed ? 264 : 420, height: options.collapsed ? 96 : 820 };
  const register = (target: Window, mode: "pip" | "popup") => {
    modes.set(target, mode);
    windows.set(key, target);
    target.document.title = "Lecturer Assistant · Пульт";
    target.document.documentElement.lang = "ru";
    target.document.body.classList.add("floating-remote-document");
    if (!target.document.body.children.length) {
      const loading = target.document.createElement("p");
      loading.dataset.remotePending = "true";
      loading.textContent = "Открываем пульт…";
      target.document.body.append(loading);
    }
    target.addEventListener(
      "pagehide",
      () => {
        if (windows.get(key) === target) windows.delete(key);
      },
      { once: true }
    );
    target.focus();
    return target;
  };
  if (options.mode !== "popup" && supportsPinnedLectureRemote()) {
    // requestWindow runs synchronously in the initiating user gesture.
    let request: Promise<Window>;
    try {
      request = (window as PictureInPictureHost).documentPictureInPicture!.requestWindow(size);
    } catch {
      pipRejected = true;
      return Promise.reject(new Error(pinFailure));
    }
    const result = request
      .then((target) => register(target, "pip"))
      .catch(() => {
        pipRejected = true;
        throw new Error(pinFailure);
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, result);
    return result;
  }
  // Keeping this outside an async continuation preserves popup user activation.
  try {
    const child = window.open(
      "about:blank",
      `lecturer-private-remote-${crypto.randomUUID()}`,
      `popup=yes,resizable=yes,scrollbars=yes,width=${size.width},height=${size.height}`
    );
    if (!child) return Promise.reject(new Error(popupFailure));
    return Promise.resolve(register(child, "popup"));
  } catch {
    return Promise.reject(new Error(popupFailure));
  }
}

/** Returns cleanup for live theme synchronization. Never closes the target window. */
export function prepareLectureRemoteWindow(target: Window): () => void {
  const doc = target.document;
  doc.title = "Lecturer Assistant · Пульт";
  doc.documentElement.lang = "ru";
  doc.body.classList.add("floating-remote-document");
  doc
    .querySelectorAll("[data-remote-pending], [data-remote-style], base[data-remote-base]")
    .forEach((node) => node.remove());
  const base = doc.createElement("base");
  base.dataset.remoteBase = "true";
  base.href = window.location.href;
  doc.head.prepend(base);
  for (const source of document.querySelectorAll('link[rel="stylesheet"], style')) {
    const copy = source.cloneNode(true) as HTMLElement;
    copy.dataset.remoteStyle = "true";
    doc.head.append(copy);
  }
  const theme = () => {
    doc.documentElement.className = document.documentElement.className;
  };
  theme();
  const observer = new MutationObserver(theme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
