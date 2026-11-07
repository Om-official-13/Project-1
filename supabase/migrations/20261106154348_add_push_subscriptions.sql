/*
# Add push_subscriptions table for Web Push notifications

1. New Tables
- `push_subscriptions` — stores each user's Web Push subscription endpoint, keys, and auth secret. Used by the notify edge function to send push notifications when messages or calls arrive while the app is in the background or closed.
- `notification_queue` — lightweight queue table for notifications that need to be sent. The edge function polls this table and sends push notifications to the target user's subscribed devices. Rows are deleted after delivery.

2. Security
- Enable RLS on both tables.
- Grant CRUD to `authenticated` only (the app requires sign-in).
- push_subscriptions: users can manage only their own subscriptions.
- notification_queue: users can insert notifications they're sending, and the edge function (service_role) can read/delete them.

3. Important Notes
- Push subscription keys (p256dh, auth) are public keys used by the Web Push protocol — they are NOT secret keys and are safe to store. The VAPID private key lives only in the edge function's secrets.
- The notification_queue allows the realtime message insert trigger to enqueue a notification row without calling the edge function directly (the edge function can't be called from a DB trigger). The edge function polls the queue on an interval.
- service_role is granted on both tables so the notify edge function can read subscriptions and delete processed queue items.
*/

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;
GRANT SELECT, DELETE ON push_subscriptions TO service_role;

DROP POLICY IF EXISTS "push_subs_select_own" ON push_subscriptions;
CREATE POLICY "push_subs_select_own"
  ON push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subs_insert_own" ON push_subscriptions;
CREATE POLICY "push_subs_insert_own"
  ON push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subs_update_own" ON push_subscriptions;
CREATE POLICY "push_subs_update_own"
  ON push_subscriptions FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subs_delete_own" ON push_subscriptions;
CREATE POLICY "push_subs_delete_own"
  ON push_subscriptions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON push_subscriptions(user_id);

-- ============================================================
-- NOTIFICATION QUEUE
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_user uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed boolean NOT NULL DEFAULT false
);

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_queue TO authenticated;
GRANT SELECT, UPDATE, DELETE ON notification_queue TO service_role;

-- Users can insert notifications (when they send a message or initiate a call)
DROP POLICY IF EXISTS "notif_queue_insert" ON notification_queue;
CREATE POLICY "notif_queue_insert"
  ON notification_queue FOR INSERT TO authenticated
  WITH CHECK (from_user = auth.uid());

-- Users can see notifications targeting them (for local handling)
DROP POLICY IF EXISTS "notif_queue_select" ON notification_queue;
CREATE POLICY "notif_queue_select"
  ON notification_queue FOR SELECT TO authenticated
  USING (target_user = auth.uid() OR from_user = auth.uid());

-- Users can delete notifications targeting them
DROP POLICY IF EXISTS "notif_queue_delete" ON notification_queue;
CREATE POLICY "notif_queue_delete"
  ON notification_queue FOR DELETE TO authenticated
  USING (target_user = auth.uid() OR from_user = auth.uid());

CREATE INDEX IF NOT EXISTS idx_notif_queue_unprocessed ON notification_queue(processed, created_at);
