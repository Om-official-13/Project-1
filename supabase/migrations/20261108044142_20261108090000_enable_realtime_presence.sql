/*
# Enable realtime delivery for user_presence

1. Purpose
- Add the user_presence table to Supabase Realtime so connected clients receive
  online/offline status changes immediately instead of relying on polling.
- This fixes the bug where an online user shows "last seen recently" because the
  presence update never reaches the other client in real time.

2. Modified tables
- `user_presence` — realtime INSERT, UPDATE, and DELETE events are enabled.

3. Security
- No RLS policies, grants, columns, or table data are changed.

4. Important notes
- Idempotent: only adds the table when not already in the publication.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
  END IF;
END
$$;