/// <reference lib="webworker" />

const CACHE_NAME = 'privyte-v3';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];
const VAPID_PUBLIC_KEY = 'BH3Hu4coQib8isEhGxbX49PUru0tGat_hd9sOtbkdV5q1OUBIdhTissEdAMrmNwVGtfzRoeW_d9dS70PUwh5Dbw';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Do not cache authenticated pages or API responses; only cache static assets.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  } else if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.json' || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    })));
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* use generic fallback */ }
  const type = payload.type === 'call' ? 'call' : 'message';
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  // Ignore remote title/body and whitelist only navigation metadata.
  const safeData = {
    type,
    ...(typeof data.fromUser === 'string' ? { fromUser: data.fromUser } : {}),
    ...(typeof data.roomId === 'string' ? { roomId: data.roomId } : {}),
  };
  event.waitUntil(self.registration.showNotification('Privyte', {
    body: type === 'call' ? 'Incoming call' : 'New message',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: type === 'call' ? 'privyte-call' : 'privyte-message',
    data: safeData,
    requireInteraction: type === 'call',
    vibrate: type === 'call' ? [200, 100, 200] : [100],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    if (clients.length) {
      const client = clients[0];
      await client.focus();
      client.postMessage({ type: 'NAVIGATE', data });
      return;
    }
    await self.clients.openWindow('/');
  }));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'RESUBSCRIBE', subscription: subscription.toJSON() });
  })());
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const rawData = atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
