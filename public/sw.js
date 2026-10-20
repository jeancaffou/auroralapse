const CACHE = "aurora-v10";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const home = new URL("./", self.location.href);
      const response = await fetch(home);
      if (!response.ok) throw new Error("App shell unavailable");
      const html = await response.clone().text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((m) => new URL(m[1], home))
        .filter((u) => u.origin === home.origin)
        .map((u) => u.href);
      await cache.put(home, response);
      await cache.addAll([
        ...new Set([
          ...assets,
          ...[
            "aurora.jpg",
            "aurora-landscape.jpg",
            "icon.svg",
            "icon-192.png",
            "icon-512.png",
            "manifest.webmanifest",
          ].map((p) => new URL(p, home).href),
        ]),
      ]);
    })(),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then(
            (response) =>
              response ||
              (event.request.mode === "navigate"
                ? caches.match(new URL("./", self.location.href).href)
                : Response.error()),
          ),
      ),
  );
});
