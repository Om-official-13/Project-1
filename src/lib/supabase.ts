import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 20 },
  },
});

export type Profile = {
  id: string;
  display_name: string;
  avatar_color: string;
  is_guest: boolean;
  last_seen: string;
  created_at: string;
};

export type Message = {
  id: string;
  room_id: string;
  sender_id: string;
  text_content: string | null;
  media_type: string | null;
  media_id: string | null;
  created_at: string;
  read_at: string | null;
  deleted_for_everyone: boolean;
  deleted_for: string[];
};

export type CallSignal = {
  id: string;
  room_id: string;
  from_user: string;
  to_user: string;
  signal_type: string;
  signal_data: Record<string, unknown>;
  created_at: string;
  expires_at: string;
};

export type UserPresence = {
  id: string;
  is_online: boolean;
  last_seen: string;
};

export type MediaStore = {
  media_id: string;
  room_id: string;
  sender_id: string;
  encrypted_data: string;
  iv_base64: string;
  key_base64: string;
  mime_type: string;
  file_name: string;
  file_size: number;
  created_at: string;
};

export function getRoomId(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join('_');
}
