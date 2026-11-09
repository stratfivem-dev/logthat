const C = 'dl-v3';
const PUSH_URL = 'https://yznhzcqqtufxkdkxxqmv.supabase.co/functions/v1/push';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin && u.hostname !== 'cdn.jsdelivr.net') return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(C).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('/')))
  );
});

// A push arrives with no content; fetch the waiting message, then show it.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let title = 'New delivery';
    let body = 'Open Delivery Log to see it.';
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const r = await fetch(PUSH_URL + '?e=' + encodeURIComponent(sub.endpoint));
        if (r.ok) {
          const j = await r.json();
          if (j.title) { title = j.title; body = j.body || body; }
        }
      }
    } catch (_) {}
    await self.registration.showNotification(title, {
      body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: './' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return clients.openWindow('./');
    })
  );
});
