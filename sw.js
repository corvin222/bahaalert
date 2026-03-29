const CACHE = 'bahaalert-v5';
const OFFLINE_ASSETS = ['/', '/index.html', '/manifest.json'];

// ── INSTALL ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
    .then(() => {
      // Notify all open tabs that a new version is active
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SW_UPDATED', cache: CACHE }));
      });
    })
  );
});

// ── FETCH ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip caching for API calls, external services
  if (url.hostname.includes('openweathermap') || url.hostname.includes('supabase') ||
      url.hostname.includes('unpkg') || url.hostname.includes('googleapis') ||
      url.hostname.includes('onesignal') || url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response('Offline', { status: 503 })));
    return;
  }

  // Network-first for HTML pages (so updates are picked up immediately)
  if (e.request.mode === 'navigate' || e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => {
        return caches.match(e.request).then(cached => cached || caches.match('/'));
      })
    );
    return;
  }

  // Cache-first for static assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => e.request.mode === 'navigate' ? caches.match('/') : null);
    })
  );
});

// ── LISTEN FOR SKIP WAITING MESSAGE FROM PAGE ──
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', e => {
  let data = { title: '🌊 BahaAlert', body: 'New flood alert in your area!', severity: 'warning', url: '/' };
  try { data = { ...data, ...e.data.json() }; } catch(err) {}

  const icon = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect width='192' height='192' rx='40' fill='%232563eb'/><text y='130' x='96' text-anchor='middle' font-size='120'>🌊</text></svg>";

  const options = {
    body: data.body,
    icon,
    badge: icon,
    tag: data.tag || 'flood-' + Date.now(),
    requireInteraction: data.severity === 'critical',
    vibrate: data.severity === 'critical' ? [300, 100, 300, 100, 300] : [200, 100, 200],
    data: { url: data.url || '/' },
    actions: [
      { action: 'view', title: '👀 View Map' },
      { action: 'dismiss', title: '✕ Dismiss' }
    ],
  };

  e.waitUntil(self.registration.showNotification(data.title, options));
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('bahaalert') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// ── BACKGROUND SYNC ──
self.addEventListener('sync', e => {
  if (e.tag === 'sync-reports') e.waitUntil(syncPendingReports());
});

async function syncPendingReports() {
  try {
    const cache = await caches.open('pending-reports');
    const keys = await cache.keys();
    for (const key of keys) {
      const res = await cache.match(key);
      const report = await res.json();
      const result = await fetch('https://dqjdnjutsxerqkpepbri.supabase.co/rest/v1/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxamRuanV0c3hlcnFrcGVwYnJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0OTE3MTcsImV4cCI6MjA5MDA2NzcxN30.nttC3ruA1WfzmS7k0HNOv0cq_PxyRhDLJYxVElbxEEA',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxamRuanV0c3hlcnFrcGVwYnJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0OTE3MTcsImV4cCI6MjA5MDA2NzcxN30.nttC3ruA1WfzmS7k0HNOv0cq_PxyRhDLJYxVElbxEEA',
        },
        body: JSON.stringify(report)
      });
      if (result.ok) await cache.delete(key);
    }
  } catch(e) { console.log('Sync failed:', e); }
}
