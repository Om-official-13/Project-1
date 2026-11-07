/*
# Enable realtime delivery for messaging and calls

1. Purpose
- Add the existing messaging tables to Supabase Realtime so connected clients receive new rows immediately.
- This fixes missed call invitations and delayed message delivery without changing stored user data.

2. Modified tables
- `messages` — realtime INSERT, UPDATE, and DELETE events are enabled.
- `call_signals` — realtime INSERT, UPDATE, and DELETE events are enabled for WebRTC signaling.

3. Security
- No RLS policies, grants, columns, or table data are changed.
- Existing row-level security continues to control which authenticated users can read the events.

4. Important notes
- The operation is idempotent and only adds a table when it is not already in the publication.
- Existing records are preserved.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'call_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals;
  END IF;
END
$$;