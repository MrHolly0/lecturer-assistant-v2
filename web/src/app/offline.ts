export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js");
    });
  }
}

export function precacheDeck(urls: string[]) {
  if (!("serviceWorker" in navigator) || urls.length === 0) return;
  void navigator.serviceWorker.ready.then((registration) => {
    const worker = navigator.serviceWorker.controller ?? registration.active;
    worker?.postMessage({ type: "PRECACHE_DECK", urls });
  });
}
