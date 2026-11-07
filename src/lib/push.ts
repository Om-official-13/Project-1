import { supabase } from '@/lib/supabase';

// VAPID public key — must match the one in the service worker and edge function
const VAPID_PUBLIC_KEY = 'BH3Hu4coQib8isEhGxbX49PUru0tGat_hd9sOtbkdV5q1OUBIdhTissEdAMrmNwVGtfzRoeW_d9dS70PUwh5Dbw';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function getPushPermissionState(): PushPermissionState {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission as PushPermissionState;
}

export async function requestPushPermission(): Promise<PushPermissionState> {
  if (!('Notification' in window)) return 'unsupported';
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const permission = await Notification.requestPermission();
  return permission as PushPermissionState;
}

export async function subscribeToPush(userId: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration>((_, reject) =>
        setTimeout(() => reject(new Error('SW timeout')), 8000),
      ),
    ]);
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    // Store the subscription in the database
    const sub = subscription.toJSON();
    if (!sub.keys) return false;

    await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh_key: sub.keys.p256dh,
      auth_key: sub.keys.auth,
    }, {
      onConflict: 'user_id,endpoint',
    });

    return true;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(userId: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }
    await supabase.from('push_subscriptions').delete().eq('user_id', userId);
  } catch {
    // ignore
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    return registration;
  } catch {
    return null;
  }
}

// ============================================================
// NOTIFICATION SENDING (via edge function)
// ============================================================

export async function sendNotificationViaEdgeFunction(params: {
  targetUser: string;
  fromUser: string;
  notificationType: 'message' | 'call';
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    const response = await fetch(`${supabaseUrl}/functions/v1/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        action: 'enqueue',
        targetUser: params.targetUser,
        fromUser: params.fromUser,
        notificationType: params.notificationType,
        title: params.title,
        body: params.body,
        data: params.data,
      }),
    });

    if (!response.ok) {
      // Non-fatal — notifications are best-effort
    }
  } catch {
    // Non-fatal — notifications are best-effort
  }
}

// ============================================================
// SERVICE WORKER MESSAGE HANDLING
// ============================================================

export type SWMessageHandler = (message: { type: string; data?: Record<string, unknown>; replyText?: string }) => void;

export function setServiceWorkerMessageHandler(handler: SWMessageHandler | null) {
  if (handler) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      handler(event.data as { type: string; data?: Record<string, unknown>; replyText?: string });
    });
  }
}

// ============================================================
// PWA INSTALL PROMPT
// ============================================================

let deferredPromptEvent: { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null = null;

export function setupInstallPrompt(onAvailable: () => void): () => void {
  const handler = (e: Event) => {
    e.preventDefault();
    deferredPromptEvent = e as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    onAvailable();
  };

  window.addEventListener('beforeinstallprompt', handler);
  return () => window.removeEventListener('beforeinstallprompt', handler);
}

export async function triggerInstall(): Promise<boolean> {
  if (!deferredPromptEvent) return false;
  await deferredPromptEvent.prompt();
  const choice = await deferredPromptEvent.userChoice;
  deferredPromptEvent = null;
  return choice.outcome === 'accepted';
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}
