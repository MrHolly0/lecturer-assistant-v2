const CACHE_NAME = "lecturer-assistant-decks-v1";
const SHELL_CACHE = "lecturer-assistant-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== SHELL_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PRECACHE_DECK") return;
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(event.data.urls || [])));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Никогда не трогаем API, SSE и WebSocket — они должны идти в сеть напрямую.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) return;

  // Навигация (загрузка/перезагрузка SPA) — сеть с откатом на закэшированную оболочку.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/", { ignoreSearch: true }))
    );
    return;
  }

  // Картинки слайдов — кэш в первую очередь (офлайн-показ дека).
  if (url.pathname.includes("/slides/") && url.pathname.endsWith("/image")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  // Сборка Vite (хэшированные ассеты) — stale-while-revalidate в оболочку.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(SHELL_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
  }
});
