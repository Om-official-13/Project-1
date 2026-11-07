/// <reference lib="webworker" />

const CACHE_NAME = 'privyte-v2';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

// VAPID public key — must match the one in the edge function
const VAPID_PUBLIC_KEY = 'BH3Hu4coQib8isEhGxbX49PUru0tGat_hd9sOtbkdV5q1OUBIdhTissEdAMrmNwVGtfzRoeW_d9dS70PUwh5Dbw';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {
      // Skip cache failures
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (url.pathname === '/' || url.pathname === '/index.html'
      ? fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => caches.match(event.request))
      : caches.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request)
            .then((response) => {
              if (response && response.status === 200) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
              }
              return response;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })),
  );
});

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================

self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Privyte', body: 'New notification', type: 'message' };
  }

  const type = payload.type || 'message';
  let actions = [];
  let title = payload.title || 'Privyte';
  let body = payload.body || '';
  let tag = payload.tag || 'privyte-notification';
  let data = payload.data || {};

  if (type === 'message') {
    actions = [
      { action: 'reply', title: 'Reply' },
    ];
    tag = `message-${data.roomId || 'general'}`;
  } else if (type === 'call') {
    actions = [
      { action: 'accept-call', title: 'Accept' },
      { action: 'decline-call', title: 'Decline' },
    ];
    tag = `call-${data.fromUser || 'unknown'}`;
    data.requireInteraction = true;
  }

  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
    actions,
    data,
    requireInteraction: type === 'call',
    vibrate: type === 'call' ? [200, 100, 200, 100, 200] : [100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ============================================================
// NOTIFICATION CLICK & INLINE ACTIONS
// ============================================================

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const data = event.notification.data || {};

  if (action === 'reply') {
    event.waitUntil(handleReplyAction(event, data));
  } else if (action === 'accept-call') {
    event.waitUntil(handleAcceptCall(data));
  } else if (action === 'decline-call') {
    event.waitUntil(handleDeclineCall(data));
  } else {
    // Default click — open the app
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        if (clientList.length > 0) {
          const client = clientList[0];
          client.focus();
          client.postMessage({ type: 'NAVIGATE', data });
          return client;
        }
        return self.clients.openWindow('/');
      }),
    );
  }
});

async function handleReplyAction(event, data) {
  // On Chrome Android, we need to use the reply action from the notification
  // The actual reply text comes from event.reply if available
  const replyText = event.reply || '';
  if (!replyText) {
    // No reply text provided — just open the app
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clientList.length > 0) {
      clientList[0].focus();
      clientList[0].postMessage({ type: 'REPLY_ACTION', data, replyText: '' });
    }
    return;
  }

  // Send the reply via the app's client
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clientList.length > 0) {
    const client = clientList[0];
    client.postMessage({ type: 'REPLY_ACTION', data, replyText });
    client.focus();
  } else {
    // App is closed — we need to open it and queue the reply
    const client = await self.clients.openWindow('/');
    if (client) {
      // Wait for the client to be ready, then send the reply
      setTimeout(() => {
        client.postMessage({ type: 'REPLY_ACTION', data, replyText });
      }, 2000);
    }
  }
}

async function handleAcceptCall(data) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clientList.length > 0) {
    const client = clientList[0];
    client.focus();
    client.postMessage({ type: 'ACCEPT_CALL', data });
  } else {
    const client = await self.clients.openWindow('/');
    if (client) {
      setTimeout(() => {
        client.postMessage({ type: 'ACCEPT_CALL', data });
      }, 2000);
    }
  }
}

async function handleDeclineCall(data) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clientList.length > 0) {
    clientList[0].postMessage({ type: 'DECLINE_CALL', data });
  }
}

// ============================================================
// PUSH SUBSCRIPTION
// ============================================================

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({ type: 'RESUBSCRIBE', subscription: subscription.toJSON() });
      }
    })(),
  );
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ============================================================
// MESSAGE FROM PAGE
// ============================================================

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
