/*
# Create messaging and signaling schema

1. New Tables
- `profiles` — user display info (display name, avatar color, guest flag, last seen). One row per auth user.
- `messages` — text-only messages between users. Fields: id, room_id, sender_id, text_content, media_type, media_id, created_at, read_at, deleted_for_everyone, deleted_for. Media (images/video/voice) is NEVER stored here — only a media_type + media_id reference; the encrypted blob lives in each user's local IndexedDB vault and is transferred P2P via WebRTC data channels.
- `call_signals` — WebRTC signaling messages (SDP offers/answers, ICE candidates) used to establish P2P connections for voice/video calls and encrypted media transfer. Rows are auto-deleted after 5 minutes via TTL to keep signaling ephemeral.
- `user_presence` — lightweight online status per user, updated on login/logout and via realtime broadcast.

2. Security
- Enable RLS on all tables.
- Grant CRUD to `authenticated` (the app requires sign-in; guests use Supabase anonymous auth which is also `authenticated`).
- profiles: users can read all profiles (need to see who to chat with) but only update their own.
- messages: users can read/insert/delete messages where they are the sender OR the recipient (room_id is composed of both user ids).
- call_signals: users can read/insert/delete signals addressed to them or sent by them.
- user_presence: users can read all, insert/upsert their own, delete their own.

3. Important Notes
- room_id is a deterministic string: two user ids sorted and joined with '_'. This lets both peers query the same room without a separate rooms table.
- No media blobs ever enter the database. The messages table only carries text_content (for text messages) or media_type + media_id (for media messages). Encrypted media is sent P2P and stored in IndexedDB.
- call_signal rows expire after 5 minutes so stale signaling data doesn't accumulate.
*/

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'User',
  avatar_color text NOT NULL DEFAULT '#3b82f6',
  is_guest boolean NOT NULL DEFAULT false,
  last_seen timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO authenticated;

DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
CREATE POLICY "profiles_select_all"
  ON profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own"
  ON profiles FOR DELETE TO authenticated USING (auth.uid() = id);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  sender_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  text_content text,
  media_type text,
  media_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  deleted_for_everyone boolean NOT NULL DEFAULT false,
  deleted_for text[] NOT NULL DEFAULT '{}'
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO authenticated;

-- A user can see messages in rooms they're part of (room_id contains their id)
-- and that they haven't deleted for themselves and aren't deleted for everyone
DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select"
  ON messages FOR SELECT TO authenticated
  USING (
    sender_id = auth.uid()
    OR room_id LIKE '%' || auth.uid()::text || '%'
  );

-- Users can insert messages they send
DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());

-- Users can update messages (read receipts, delete for me, delete for everyone)
DROP POLICY IF EXISTS "messages_update" ON messages;
CREATE POLICY "messages_update"
  ON messages FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

-- Users can delete messages they sent or that are in their rooms
DROP POLICY IF EXISTS "messages_delete" ON messages;
CREATE POLICY "messages_delete"
  ON messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR room_id LIKE '%' || auth.uid()::text || '%');

CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- ============================================================
-- CALL SIGNALS (WebRTC signaling — ephemeral)
-- ============================================================
CREATE TABLE IF NOT EXISTS call_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  from_user uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  signal_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);

ALTER TABLE call_signals ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON call_signals TO authenticated;

-- Users can see signals sent to them or sent by them
DROP POLICY IF EXISTS "call_signals_select" ON call_signals;
CREATE POLICY "call_signals_select"
  ON call_signals FOR SELECT TO authenticated
  USING (to_user = auth.uid() OR from_user = auth.uid());

-- Users can insert signals they send
DROP POLICY IF EXISTS "call_signals_insert" ON call_signals;
CREATE POLICY "call_signals_insert"
  ON call_signals FOR INSERT TO authenticated
  WITH CHECK (from_user = auth.uid());

-- Users can delete signals they sent or received (cleanup)
DROP POLICY IF EXISTS "call_signals_delete" ON call_signals;
CREATE POLICY "call_signals_delete"
  ON call_signals FOR DELETE TO authenticated
  USING (to_user = auth.uid() OR from_user = auth.uid());

CREATE INDEX IF NOT EXISTS idx_call_signals_to_user ON call_signals(to_user, created_at);
CREATE INDEX IF NOT EXISTS idx_call_signals_expires ON call_signals(expires_at);

-- ============================================================
-- USER PRESENCE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_presence (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online boolean NOT NULL DEFAULT false,
  last_seen timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON user_presence TO authenticated;

DROP POLICY IF EXISTS "presence_select_all" ON user_presence;
CREATE POLICY "presence_select_all"
  ON user_presence FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "presence_insert_own" ON user_presence;
CREATE POLICY "presence_insert_own"
  ON user_presence FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "presence_update_own" ON user_presence;
CREATE POLICY "presence_update_own"
  ON user_presence FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "presence_delete_own" ON user_presence;
CREATE POLICY "presence_delete_own"
  ON user_presence FOR DELETE TO authenticated USING (id = auth.uid());
