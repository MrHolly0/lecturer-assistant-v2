const CACHE_NAME = "lecturer-assistant-decks-v2";
const SHELL_CACHE = "lecturer-assistant-shell-v2";
const STATIC_SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
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
  event.waitUntil(precacheDeckImages(event.data.urls || []));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Slide image is the only API resource cached for offline presentation mode.
  if (isSlideImage(url)) {
    const cacheKey = slideCacheKey(url);
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(cacheKey).then((cached) => {
          if (cached) return cached;
          return fetch(request).then(async (response) => {
            if (response.ok) await cache.put(cacheKey, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Other API, SSE and WebSocket requests must always go directly to the network.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) return;

  // Навигация (загрузка/перезагрузка SPA) — сеть с откатом на закэшированную оболочку.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/", { ignoreSearch: true })));
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

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const shellResponse = await fetch("/", { cache: "no-store" });
  if (!shellResponse.ok) throw new Error(`Shell request failed: ${shellResponse.status}`);

  const html = await shellResponse.clone().text();
  const hashedAssets = Array.from(
    new Set(
      Array.from(html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g), (match) => match[1])
    )
  );

  await cache.put("/", shellResponse);
  await cache.addAll([...STATIC_SHELL_ASSETS, ...hashedAssets]);
}

async function precacheDeckImages(urls) {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    urls.map(async (rawUrl) => {
      const request = new Request(rawUrl, { credentials: "same-origin" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`Slide request failed: ${response.status}`);
      await cache.put(slideCacheKey(new URL(request.url)), response);
    })
  );
}

function isSlideImage(url) {
  return url.pathname.includes("/slides/") && url.pathname.endsWith("/image");
}

function slideCacheKey(url) {
  const normalized = new URL(url.toString());
  normalized.searchParams.delete("t");
  return normalized.toString();
}
