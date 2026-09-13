const CACHE = 'tempo-shell-v1';
const BUILD_ASSETS = [];
const BASE = new URL('./', self.location.href).pathname;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([BASE, `${BASE}icon-192.png`, `${BASE}icon-512.png`, `${BASE}manifest.webmanifest`, ...BUILD_ASSETS])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tempo-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/@') || url.pathname.includes('node_modules') || url.pathname.startsWith('/src/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok && !url.search) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(BASE, copy))); }
      return response;
    }).catch(() => caches.match(BASE)));
  } else {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy))); }
      return response;
    })));
  }
});
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let message;
    try { message = event.data?.json(); } catch { return; }
    if (!message?.title || !message?.tag || typeof message.title !== 'string') return;
    const seen = await caches.open('tempo-notifications-v1');
    const marker = new URL(`/__notification/${encodeURIComponent(message.tag)}`, self.location.origin).href;
    if (await seen.match(marker)) return;
    if (message.verifyUrl) {
      const url = new URL(message.verifyUrl);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) return;
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok || !(await response.json()).valid) return;
      } catch { return; }
    }
    await self.registration.showNotification(message.title, {
      body: message.body || '시간이 다 됐어요.', tag: message.tag, icon: `${BASE}icon-192.png`, badge: `${BASE}icon-192.png`,
      silent: !message.sound, data: { timerId: message.timerId },
    });
    await seen.put(marker, new Response('shown'));
    const keys = await seen.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - 100))) await seen.delete(key);
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith(BASE));
    return existing ? existing.focus() : self.clients.openWindow(BASE);
  }));
});
