const CACHE_NAME = 'bahaalert-v1';
const OFFLINE_URL = '/';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── INSTALL ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH (cache first for app shell, network first for API) ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for API calls
  if (
    url.hostname.includes('openweathermap') ||
    url.hostname.includes('supabase') ||
    url.hostname.includes('arcgisonline') ||
    url.hostname.includes('leaflet') ||
    url.hostname.includes('unpkg') ||
    url.hostname.includes('googleapis')
  ) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('Offline', { status: 503 }))
    );
    return;
  }

  // Cache first for app shell
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  let data = { title: '🌊 BahaAlert', body: 'New flood alert in your area!' };
  try { data = event.data.json(); } catch(e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect width='192' height='192' rx='40' fill='%232563eb'/><text y='130' x='96' text-anchor='middle' font-size='120'>🌊</text></svg>",
      badge: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><rect width='96' height='96' rx='20' fill='%232563eb'/><text y='65' x='48' text-anchor='middle' font-size='60'>🌊</text></svg>",
      tag: data.tag || 'flood-alert',
      requireInteraction: data.critical || false,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' }
    })
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── BACKGROUND SYNC (retry failed reports) ──
self.addEventListener('sync', event => {
  if (event.tag === 'sync-reports') {
    event.waitUntil(syncPendingReports());
  }
});

async function syncPendingReports() {
  try {
    const cache = await caches.open('pending-reports');
    const keys = await cache.keys();
    for (const key of keys) {
      const response = await cache.match(key);
      const report = await response.json();
      // Retry posting the report
      const result = await fetch('https://dqjdnjutsxerqkpepbri.supabase.co/rest/v1/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxamRuanV0c3hlcnFrcGVwYnJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0OTE3MTcsImV4cCI6MjA5MDA2NzcxN30.nttC3ruA1WfzmS7k0HNOv0cq_PxyRhDLJYxVElbxEEA',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxamRuanV0c3hlcnFrcGVwYnJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0OTE3MTcsImV4cCI6MjA5MDA2NzcxN30.nttC3ruA1WfzmS7k0HNOv0cq_PxyRhDLJYxVElbxEEA',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(report)
      });
      if (result.ok) await cache.delete(key);
    }
  } catch(e) {
    console.log('Sync failed, will retry:', e);
  }
}
