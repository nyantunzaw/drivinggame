// Offline cache: the game is static files, so cache-first with background refresh.
const CACHE = 'yangon-vice-v4';
const CORE = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'data/yangon.json', 'data/radar.webp', 'data/shops.json', 'vendor/three.module.min.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  'src/main.js', 'src/gfxguard.js', 'src/config.js', 'src/util.js', 'src/data.js', 'src/terrain.js', 'src/textures.js', 'src/facades.js', 'src/input.js',
  'src/camera.js', 'src/player.js', 'src/audio.js', 'src/fx.js', 'src/missions.js',
  'src/world/sky.js', 'src/world/collision.js', 'src/world/materials.js', 'src/world/geo.js', 'src/world/props.js',
  'src/world/chunks.js', 'src/world/static.js', 'src/world/landmarks.js', 'src/world/shops.js', 'src/world/medians.js',
  'src/vehicles/models.js', 'src/vehicles/renderer.js', 'src/vehicles/vehicle.js',
  'src/humans/human.js', 'src/humans/renderer.js',
  'src/ai/roadgraph.js', 'src/ai/driver.js', 'src/ai/traffic.js', 'src/ai/parked.js', 'src/ai/peds.js', 'src/ai/police.js',
  'src/ui/hud.js', 'src/ui/minimap.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
