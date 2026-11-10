// Heritage Operations Hub service worker: shows phone push alerts and opens the right page when tapped.
// It does not cache pages or track location.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Heritage Operations Hub', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Heritage Operations Hub', {
    body: data.body || '',
    tag: data.tag,
    icon: '/icon.png',
    badge: '/icon.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) { await w.focus(); return w.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
