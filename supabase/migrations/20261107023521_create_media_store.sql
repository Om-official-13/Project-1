/*
# Create encrypted media store

## Purpose
Previously, encrypted photos/videos/voice notes were only delivered via a live
realtime broadcast. If the recipient was not in the chat at the exact moment
the sender sent the media, the encrypted blob was lost forever — the message
row existed in the database but the actual media could never be retrieved.
Text messages worked fine because text_content is stored directly in the
messages table.

This migration creates a `media_store` table so encrypted media blobs are
persisted in the database. The recipient can fetch the encrypted blob on
demand (immediately or hours later), decrypt it locally, and display it.

## New Table
- `media_store`
  - `media_id` (uuid, primary key) — matches the `media_id` in the messages table
  - `room_id` (text, not null) — the chat room this media belongs to
  - `sender_id` (uuid, not null, defaults to auth.uid()) — who sent it
  - `encrypted_data` (text, not null) — base64-encoded AES-GCM encrypted blob
  - `iv_base64` (text, not null) — initialization vector for decryption
  - `key_base64` (text, not null) — AES-256 key for decryption
  - `mime_type` (text, not null) — original file MIME type
  - `file_name` (text, not null) — original file name
  - `file_size` (bigint, not null) — original file size in bytes
  - `created_at` (timestamptz, default now())

## Security
- RLS enabled on `media_store`.
- Grant CRUD to `authenticated` only (app requires sign-in).
- SELECT: users can read media in rooms they are part of (room_id contains their id).
- INSERT: users can insert media they send (sender_id = auth.uid()).
- UPDATE: users can update media they sent.
- DELETE: users can delete media in their rooms.

## Notes
1. The encrypted_data is base64 which increases size by ~33%, but this is
   acceptable for reliability. Large videos may be subject to Postgres row
   size limits — the text type supports up to 1GB.
2. The decryption key is stored alongside the encrypted data. This is
   end-to-end encrypted in the sense that the media is encrypted at rest
   and only the sender and recipient can decrypt it. The key travels with
   the payload, so anyone with database access could decrypt — this matches
   the existing encryption model where the key was sent in the broadcast.
*/
CREATE TABLE IF NOT EXISTS media_store (
  media_id uuid PRIMARY KEY,
  room_id text NOT NULL,
  sender_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_data text NOT NULL,
  iv_base64 text NOT NULL,
  key_base64 text NOT NULL,
  mime_type text NOT NULL,
  file_name text NOT NULL,
  file_size bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE media_store ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON media_store TO authenticated;

DROP POLICY IF EXISTS "media_store_select" ON media_store;
CREATE POLICY "media_store_select"
  ON media_store FOR SELECT TO authenticated
  USING (
    sender_id = auth.uid()
    OR room_id LIKE '%' || auth.uid()::text || '%'
  );

DROP POLICY IF EXISTS "media_store_insert" ON media_store;
CREATE POLICY "media_store_insert"
  ON media_store FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "media_store_update" ON media_store;
CREATE POLICY "media_store_update"
  ON media_store FOR UPDATE TO authenticated
  USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "media_store_delete" ON media_store;
CREATE POLICY "media_store_delete"
  ON media_store FOR DELETE TO authenticated
  USING (
    sender_id = auth.uid()
    OR room_id LIKE '%' || auth.uid()::text || '%'
  );

CREATE INDEX IF NOT EXISTS idx_media_store_room_id ON media_store(room_id);
CREATE INDEX IF NOT EXISTS idx_media_store_created_at ON media_store(created_at DESC);
