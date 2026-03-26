const CACHE = 'bahaalert-v3';
const OFFLINE_ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('openweathermap') || url.hostname.includes('supabase') || url.hostname.includes('unpkg')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', {status:503})));
    return;
  }
  if (url.hostname.includes('carto') || url.hostname.includes('openstreetmap')) {
    e.respondWith(fetch(e.request).then(res => {
      caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
    caches.open(CACHE).then(c => c.put(e.request, res.clone()));
    return res;
  })));
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(self.registration.showNotification(data.title || 'BahaAlert', {
    body: data.body || 'New flood alert in your area',
    icon: '/icon-192.png',
    vibrate: [200,100,200],
    data: {url: data.url || '/'},
    actions: [{action:'view',title:'🗺️ View Map'},{action:'dismiss',title:'Dismiss'}]
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action !== 'dismiss') e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
