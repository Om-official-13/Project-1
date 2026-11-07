import { useCallback, useEffect, useState } from 'react';
import { supabase, type Profile, type UserPresence } from '@/lib/supabase';

const PRESENCE_TIMEOUT_MS = 90_000;

export type ContactWithPresence = Profile & {
  is_online: boolean;
  last_seen: string;
};

export function isPresenceOnline(presence?: UserPresence): boolean {
  if (!presence) return false;
  return presence.is_online && Date.now() - new Date(presence.last_seen).getTime() < PRESENCE_TIMEOUT_MS;
}

function withPresence(profile: Profile, presence?: UserPresence): ContactWithPresence {
  const lastSeen = presence?.last_seen ?? profile.last_seen;
  return {
    ...profile,
    is_online: isPresenceOnline(presence),
    last_seen: lastSeen,
  };
}

export function usePresence() {
  const [presenceMap, setPresenceMap] = useState<Record<string, UserPresence>>({});

  useEffect(() => {
    const channel = supabase
      .channel('presence_all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_presence' },
        (payload) => {
          const presence = payload.new as UserPresence;
          setPresenceMap((prev) => ({ ...prev, [presence.id]: presence }));
        },
      )
      .subscribe();

    const refreshPresenceClock = window.setInterval(() => {
      setPresenceMap((previous) => ({ ...previous }));
    }, 30_000);

    (async () => {
      const { data } = await supabase.from('user_presence').select('id, is_online, last_seen');
      if (data) {
        const map: Record<string, UserPresence> = {};
        for (const presence of data as UserPresence[]) {
          map[presence.id] = presence;
        }
        setPresenceMap(map);
      }
    })();

    return () => {
      window.clearInterval(refreshPresenceClock);
      supabase.removeChannel(channel);
    };
  }, []);

  return presenceMap;
}

export function useContacts(currentUserId: string) {
  const [contacts, setContacts] = useState<ContactWithPresence[]>([]);
  const presenceMap = usePresence();

  const addContact = useCallback((contact: ContactWithPresence) => {
    setContacts((previous) => [contact, ...previous.filter((item) => item.id !== contact.id)]);
  }, []);

  const searchUsers = useCallback(async (query: string): Promise<ContactWithPresence[]> => {
    const userId = query.trim();
    if (!currentUserId || !userId || userId === currentUserId) return [];

    const profileFields = 'id, display_name, avatar_color, is_guest, last_seen, created_at';
    const { data: byId } = await supabase
      .from('profiles')
      .select(profileFields)
      .eq('id', userId)
      .maybeSingle();

    if (byId) return [withPresence(byId as Profile, presenceMap[(byId as Profile).id])];

    const { data: byName } = await supabase
      .from('profiles')
      .select(profileFields)
      .ilike('display_name', userId)
      .maybeSingle();

    return byName ? [withPresence(byName as Profile, presenceMap[(byName as Profile).id])] : [];
  }, [currentUserId, presenceMap]);

  useEffect(() => {
    if (!currentUserId) {
      setContacts([]);
      return;
    }

    (async () => {
      const { data } = await supabase
        .from('messages')
        .select('room_id, created_at')
        .like('room_id', `%${currentUserId}%`)
        .order('created_at', { ascending: false });

      const peerIds: string[] = [];
      for (const message of data ?? []) {
        const peerId = (message.room_id as string).split('_').find((id) => id !== currentUserId);
        if (peerId && !peerIds.includes(peerId)) peerIds.push(peerId);
      }

      if (peerIds.length === 0) {
        setContacts([]);
        return;
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_color, is_guest, last_seen, created_at')
        .in('id', peerIds);

      const byId = new Map((profiles as Profile[] | null ?? []).map((profile) => [profile.id, profile]));
      setContacts(peerIds.flatMap((peerId) => {
        const profile = byId.get(peerId);
        return profile ? [withPresence(profile, presenceMap[peerId])] : [];
      }));
    })();
  }, [currentUserId, presenceMap]);

  return { contacts, searchUsers, addContact };
}
