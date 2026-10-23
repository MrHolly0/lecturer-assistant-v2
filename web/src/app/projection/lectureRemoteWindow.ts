export type LectureRemoteWindowOptions = {
  windowKey?: string;
  collapsed?: boolean;
  mode?: "auto" | "popup";
};
type PictureInPictureHost = Window & {
  documentPictureInPicture?: {
    requestWindow: (options: {
      width: number;
      height: number;
      disallowReturnToOpener: boolean;
      preferInitialWindowPlacement: boolean;
    }) => Promise<Window>;
  };
};
const windows = new Map<string, Window>();
const pending = new Map<string, Promise<Window>>();
const modes = new WeakMap<Window, "pip" | "popup">();
const collapsedViews = new Map<string, boolean>();
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

export function lectureRemoteCollapsed(windowKey: string): boolean {
  return collapsedViews.get(windowKey) ?? false;
}

export function rememberLectureRemoteCollapsed(windowKey: string, collapsed: boolean): void {
  collapsedViews.set(windowKey, collapsed);
}

const expandedSize = { width: 420, height: 640 };
const collapsedSize = { width: 264, height: 60 };

function remoteWindowSize(target: Window, collapsed: boolean) {
  const size = collapsed ? collapsedSize : expandedSize;
  return {
    width: Math.min(size.width, Math.max(240, (target.screen?.availWidth || 444) - 24)),
    height: Math.min(size.height, Math.max(60, (target.screen?.availHeight || 736) - 96))
  };
}

/** Only an explicit compact/expanded action may resize the remote, never its content. */
export function resizeLectureRemoteWindow(target: Window, collapsed: boolean): void {
  if (target.closed) return;
  const size = remoteWindowSize(target, collapsed);
  try {
    target.resizeTo(
      size.width + Math.max(0, target.outerWidth - target.innerWidth),
      size.height + Math.max(0, target.outerHeight - target.innerHeight)
    );
  } catch {
    // Browsers can refuse resizing. The panel still fits its viewport and scrolls inside.
  }
}

/** Call directly from a click, before awaiting requests or mounting the panel. */
export function openLectureRemoteWindow(options: LectureRemoteWindowOptions = {}): Promise<Window> {
  const key = options.windowKey ?? "default";
  const collapsed = options.collapsed ?? lectureRemoteCollapsed(key);
  rememberLectureRemoteCollapsed(key, collapsed);
  const existing = windows.get(key);
  if (existing && !existing.closed) {
    existing.focus();
    return Promise.resolve(existing);
  }
  const opening = pending.get(key);
  if (opening) return opening;
  const size = remoteWindowSize(window, collapsed);
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
      request = (window as PictureInPictureHost).documentPictureInPicture!.requestWindow({
        ...size,
        disallowReturnToOpener: true,
        preferInitialWindowPlacement: true
      });
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
      // WebKit honors this utility-window hint, including its system zoom button.
      // Explicit collapse/expand can still resize it through resizeTo.
      `popup=yes,resizable=no,scrollbars=yes,width=${size.width},height=${size.height}`
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
  doc.documentElement.dataset.lectureRemote = "true";
  doc.title = "Lecturer Assistant · Пульт";
  doc.documentElement.lang = "ru";
  doc.body.classList.add("floating-remote-document");
  if (target === window) return () => {};
  doc
    .querySelectorAll("[data-remote-pending], [data-remote-style], base[data-remote-base]")
    .forEach((node) => node.remove());
  const base = doc.createElement("base");
  base.dataset.remoteBase = "true";
  base.href = window.location.href;
  doc.head.prepend(base);
  for (const source of document.querySelectorAll('link[rel="stylesheet"], style')) {
    let copy: HTMLElement;
    if (source.tagName === "LINK") {
      const link = source as HTMLLinkElement;
      let css: string | null = null;
      try {
        if (link.sheet) css = Array.from(link.sheet.cssRules, (rule) => rule.cssText).join("\n");
      } catch {
        // Cross-origin stylesheets do not expose their rules; keep a link for those.
      }
      if (css !== null) {
        // Apply already-loaded application styles synchronously in the new window.
        const style = doc.createElement("style");
        style.textContent = css;
        style.media = link.media;
        copy = style;
      } else {
        copy = doc.createElement("link");
        for (const attribute of source.attributes)
          copy.setAttribute(attribute.name, attribute.value);
        copy.setAttribute("href", link.href);
      }
    } else copy = source.cloneNode(true) as HTMLElement;
    copy.dataset.remoteStyle = "true";
    doc.head.append(copy);
  }
  const theme = () => {
    doc.documentElement.className = document.documentElement.className;
    doc.documentElement.style.cssText = document.documentElement.style.cssText;
    doc.documentElement.dataset.appTheme = document.documentElement.dataset.appTheme;
  };
  theme();
  const observer = new MutationObserver(theme);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-app-theme"]
  });
  return () => observer.disconnect();
}
