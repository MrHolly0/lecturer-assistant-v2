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
const lastSizes = new WeakMap<
  Window,
  { width: number; height: number; collapsed: boolean; measuredWidth: number }
>();
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

/** Measure natural content, independently of the scroll viewport and browser window chrome. */
export function fitLectureRemoteWindow(target: Window, panel: HTMLElement, force = false): void {
  if (target.closed) return;
  const collapsed = panel.classList.contains("is-collapsed");
  const previous = lastSizes.get(target);
  const width = collapsed
    ? 264
    : force || previous?.collapsed
      ? 420
      : previous && target.innerWidth === previous.measuredWidth
        ? previous.width
        : Math.min(420, target.innerWidth || 420);
  const chromeHeight = Math.max(0, target.outerHeight - target.innerHeight);
  const maxHeight = Math.max(64, Math.min(780, target.screen.availHeight - chromeHeight - 24));
  const parts = [".floating-remote-header", ".floating-remote-content", ".floating-remote-footer"];
  const naturalHeight = parts.reduce((height, selector, index) => {
    if (collapsed && index > 0) return height;
    return (
      height + (panel.querySelector<HTMLElement>(selector)?.getBoundingClientRect().height ?? 0)
    );
  }, 0);
  const height = Math.min(maxHeight, Math.max(60, Math.ceil(naturalHeight)));
  if (!force && previous?.width === width && previous.height === height) {
    previous.measuredWidth = target.innerWidth;
    return;
  }
  try {
    target.resizeTo(
      width + Math.max(0, target.outerWidth - target.innerWidth),
      height + chromeHeight
    );
    lastSizes.set(target, { width, height, collapsed, measuredWidth: target.innerWidth });
  } catch {
    // PiP can require a user gesture. The scroll viewport keeps every action accessible.
  }
}

/** Observe the natural inner content, never a height tied to the window being resized. */
export function observeLectureRemoteWindowSize(target: Window, panel: HTMLElement): () => void {
  let disposed = false;
  const fit = () => {
    if (!disposed) fitLectureRemoteWindow(target, panel);
  };
  const observer = new (target as Window & typeof globalThis).ResizeObserver(fit);
  let interactionFrame = 0;
  const afterInteraction = () => {
    target.cancelAnimationFrame(interactionFrame);
    interactionFrame = target.requestAnimationFrame(fit);
  };
  for (const part of panel.querySelectorAll<HTMLElement>(
    ".floating-remote-header, .floating-remote-content, .floating-remote-footer"
  ))
    observer.observe(part);
  const styles = target.document.querySelectorAll('link[rel="stylesheet"]');
  styles.forEach((style) => style.addEventListener("load", fit));
  target.document.addEventListener("click", afterInteraction);
  void target.document.fonts.ready.then(fit);
  fit();
  return () => {
    disposed = true;
    observer.disconnect();
    target.cancelAnimationFrame(interactionFrame);
    target.document.removeEventListener("click", afterInteraction);
    styles.forEach((style) => style.removeEventListener("load", fit));
  };
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
  const size = { width: collapsed ? 264 : 420, height: collapsed ? 60 : 400 };
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
