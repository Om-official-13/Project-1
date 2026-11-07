import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type Profile } from '@/lib/supabase';
import { subscribeToPush, unsubscribeFromPush, registerServiceWorker } from '@/lib/push';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  pushEnabled: boolean;
  signInWithUsername: (username: string, password: string) => Promise<{ error: string | null }>;
  signUpWithUsername: (username: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  enablePushNotifications: () => Promise<boolean>;
  disablePushNotifications: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AVATAR_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f97316', '#84cc16',
];

function pickColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);

  async function trySubscribePush(uid: string): Promise<boolean> {
    try {
      const ok = await Promise.race([
        subscribeToPush(uid),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
      ]);
      setPushEnabled(ok);
      return ok;
    } catch {
      setPushEnabled(false);
      return false;
    }
  }

  async function loadProfile(uid: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();
    if (data) setProfile(data as Profile);
  }

  async function ensureProfile(uid: string, displayName?: string, isGuest = false) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();

    if (existing) {
      const requestedName = displayName?.trim();
      const defaultName = `User ${uid.slice(0, 4)}`;
      if (requestedName && existing.display_name === defaultName && existing.display_name !== requestedName) {
        const { data: updated } = await supabase
          .from('profiles')
          .update({ display_name: requestedName, is_guest: isGuest || existing.is_guest })
          .eq('id', uid)
          .select('*')
          .maybeSingle();
        if (updated) {
          setProfile(updated as Profile);
          return;
        }
      }
      setProfile(existing as Profile);
      return;
    }

    const name = displayName?.trim() || `User ${uid.slice(0, 4)}`;
    const { data: created } = await supabase
      .from('profiles')
      .insert({
        id: uid,
        display_name: name,
        avatar_color: pickColor(uid),
        is_guest: isGuest,
      })
      .select('*')
      .maybeSingle();

    if (created) setProfile(created as Profile);
  }

  useEffect(() => {
    registerServiceWorker();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        const uid = data.session!.user.id;
        (async () => {
          await ensureProfile(uid);
          await supabase.from('user_presence').upsert({
            id: uid,
            is_online: true,
            last_seen: new Date().toISOString(),
          });
          setLoading(false);
          // Push subscription is best-effort — never block the UI on it
          trySubscribePush(uid);
        })();
      } else {
        setLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        const uid = newSession.user.id;
        (async () => {
          await ensureProfile(uid);
          await supabase.from('user_presence').upsert({
            id: uid,
            is_online: true,
            last_seen: new Date().toISOString(),
          });
          setLoading(false);
          // Push subscription is best-effort — never block the UI on it
          trySubscribePush(uid);
        })();
      } else {
        setProfile(null);
        setPushEnabled(false);
        setLoading(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const markOnline = () => {
      void supabase.from('user_presence').upsert({
        id: user.id,
        is_online: true,
        last_seen: new Date().toISOString(),
      });
    };

    const markOffline = () => {
      void supabase.from('user_presence').upsert({
        id: user.id,
        is_online: false,
        last_seen: new Date().toISOString(),
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        markOnline();
      } else {
        markOffline();
      }
    };

    markOnline();
    const interval = window.setInterval(markOnline, 30_000);
    window.addEventListener('beforeunload', markOffline);
    window.addEventListener('pagehide', markOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('beforeunload', markOffline);
      window.removeEventListener('pagehide', markOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      markOffline();
    };
  }, [user]);

  function usernameToEmail(username: string): string {
    const normalized = username.trim().toLowerCase();
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `user-${(hash >>> 0).toString(16)}@privyte.app`;
  }

  async function signInWithUsername(username: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    return { error: error?.message ?? null };
  }

  async function signUpWithUsername(username: string, password: string) {
    const { data, error } = await supabase.auth.signUp({
      email: usernameToEmail(username),
      password,
    });
    if (error) return { error: error.message };
    if (!data.user || !data.session) {
      return { error: 'Account ready hai, lekin email confirmation enabled hai. Supabase mein email confirmation off karein.' };
    }
    await ensureProfile(data.user.id, username, false);
    return { error: null };
  }

  async function signOut() {
    if (user) {
      await unsubscribeFromPush(user.id);
      await supabase.from('user_presence').upsert({
        id: user.id,
        is_online: false,
        last_seen: new Date().toISOString(),
      });
    }
    setPushEnabled(false);
    await supabase.auth.signOut();
    setProfile(null);
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.id);
  }

  async function enablePushNotifications(): Promise<boolean> {
    if (!user) return false;
    const ok = await trySubscribePush(user.id);
    return ok ?? false;
  }

  async function disablePushNotifications() {
    if (!user) return;
    await unsubscribeFromPush(user.id);
    setPushEnabled(false);
  }

  return (
    <AuthContext.Provider
      value={{ session, user, profile, loading, pushEnabled, signInWithUsername, signUpWithUsername, signOut, refreshProfile, enablePushNotifications, disablePushNotifications }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
