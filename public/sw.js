// Minimal service worker — caches the app shell so the app opens instantly
// and shows something even with a flaky connection. Data itself always comes
// live from Supabase, so this does not affect data freshness.
const CACHE_NAME = "tp-textiles-shell-v1";
const SHELL_FILES = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Never cache API/data calls to Supabase — only the static app shell.
  if (event.request.method !== "GET" || event.request.url.includes("supabase.co")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
