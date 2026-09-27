export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js");
    });
  }
  watchAppVersion();
}

function watchAppVersion() {
  sessionStorage.removeItem("la_app_updating");
  const currentAsset = document
    .querySelector<HTMLScriptElement>("script[type='module'][src^='/assets/']")
    ?.getAttribute("src");
  if (!currentAsset) return;
  let checking = false;
  let lastCheck = 0;
  const check = async () => {
    if (
      checking ||
      !navigator.onLine ||
      document.visibilityState !== "visible" ||
      Date.now() - lastCheck < 30_000
    )
      return;
    checking = true;
    lastCheck = Date.now();
    try {
      const response = await fetch("/", { cache: "no-store" });
      if (!response.ok) return;
      const html = await response.text();
      const nextAsset = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1];
      if (nextAsset && nextAsset !== currentAsset) {
        sessionStorage.setItem("la_app_updating", "true");
        window.location.reload();
      }
    } catch {
      // The current page remains usable until the connection returns.
    } finally {
      checking = false;
    }
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  window.setInterval(check, 60_000);
  void check();
}

export function precacheDeck(urls: string[]) {
  if (!("serviceWorker" in navigator) || urls.length === 0) return;
  void navigator.serviceWorker.ready.then((registration) => {
    const worker = navigator.serviceWorker.controller ?? registration.active;
    worker?.postMessage({ type: "PRECACHE_DECK", urls });
  });
}
