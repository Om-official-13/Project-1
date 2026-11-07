import { supabase } from '@/lib/supabase';

// This is public application configuration, never a secret. It must match the
// public VAPID key configured as a Supabase Edge Function secret.
const VAPID_PUBLIC_KEY = 'BH3Hu4coQib8isEhGxbX49PUru0tGat_hd9sOtbkdV5q1OUBIdhTissEdAMrmNwVGtfzRoeW_d9dS70PUwh5Dbw';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const rawData = atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

export type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function getPushPermissionState(): PushPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as PushPermissionState;
}

export async function requestPushPermission(): Promise<PushPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  return await Notification.requestPermission() as PushPermissionState;
}

export async function subscribeToPush(userId: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;

  try {
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
    }
    if (Notification.permission !== 'granted') return false;

    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration>((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 8000)),
    ]);
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token || sessionData.session.user.id !== userId) return false;
    const sub = subscription.toJSON();
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys.auth) return false;

    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh_key: sub.keys.p256dh,
      auth_key: sub.keys.auth,
    }, { onConflict: 'user_id,endpoint' });
    return !error;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(userId: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    await supabase.from('push_subscriptions').delete().eq('user_id', userId);
  } catch {
    // Best-effort cleanup; the subscription can be removed on the next sign-in.
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/**
 * Request a generic push. The Edge Function verifies the session and checks
 * Supabase for a recent matching message/call signal; caller-provided title,
 * body, and arbitrary data are deliberately never sent or trusted.
 */
export async function sendNotificationViaEdgeFunction(params: {
  targetUser: string;
  fromUser: string;
  notificationType: 'message' | 'call';
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    if (!accessToken || data.session?.user.id !== params.fromUser || !supabaseUrl || !anonKey) return;

    await fetch(`${supabaseUrl}/functions/v1/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        targetUser: params.targetUser,
        fromUser: params.fromUser,
        notificationType: params.notificationType,
        roomId: typeof params.data?.roomId === 'string' ? params.data.roomId : undefined,
      }),
    });
  } catch {
    // Notifications are best-effort and contain no message content.
  }
}

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
