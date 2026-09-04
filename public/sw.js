// Service worker — caches static assets for offline/installed-app use, but
// NEVER caches the HTML page itself in a stale way. Every new deploy renames
// the JS bundle (e.g. index-abc123.js -> index-xyz789.js); if the HTML were
// served from an old cache it would request a JS file that no longer exists
// on the server (404), breaking the whole app. Network-first for navigation
// requests prevents that permanently.
const CACHE_NAME = "tp-textiles-shell-v2";
const SHELL_FILES = ["/manifest.json", "/icon-192.png", "/icon-512.png"];

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
  const req = event.request;
  if (req.method !== "GET" || req.url.includes("supabase.co")) return;

  // Page loads: always try the network first so the HTML (and the JS bundle
  // hash it references) is always current. Only fall back to a cached copy
  // if there's genuinely no network connection.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else (icons, manifest, hashed JS/CSS assets): cache-first is
  // safe here because Vite content-hashes these filenames — an old cached
  // entry simply won't match a new build's URL, so it never goes stale.
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
