// Authenticated, generic Web Push sender. Message text, names, filenames,
// media types, and arbitrary caller-supplied notification data are never sent.
import { create } from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey, X-Client-Info",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@privyte.app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function canonicalRoom(a: string, b: string) {
  return [a, b].sort().join("_");
}

async function rest(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey!,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(method === "POST" ? { Prefer: "return=minimal" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

async function hasRecentEvent(type: string, roomId: string, fromUser: string, targetUser: string) {
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const params = new URLSearchParams({
    select: "id",
    room_id: `eq.${roomId}`,
    sender_id: `eq.${fromUser}`,
    created_at: `gte.${since}`,
    limit: "1",
  });
  if (type === "call") {
    params.delete("sender_id");
    params.set("from_user", `eq.${fromUser}`);
    params.set("to_user", `eq.${targetUser}`);
    params.set("signal_type", "eq.call_offer");
    return (await rest(`call_signals?${params}`)).length > 0;
  }
  return (await rest(`messages?${params}`)).length > 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "Notification service is not configured" }, 503);
  }

  try {
    const authorization = req.headers.get("Authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Unauthorized" }, 401);

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!authResponse.ok) return json({ error: "Unauthorized" }, 401);
    const authenticatedUser = await authResponse.json();

    const body = await req.json();
    const { targetUser, fromUser, notificationType, roomId } = body ?? {};
    if (!validUuid(targetUser) || !validUuid(fromUser) || authenticatedUser.id !== fromUser || targetUser === fromUser) {
      return json({ error: "Invalid request" }, 400);
    }
    if (notificationType !== "message" && notificationType !== "call") return json({ error: "Invalid request" }, 400);
    if (typeof roomId !== "string" || roomId !== canonicalRoom(fromUser, targetUser)) return json({ error: "Invalid request" }, 400);
    if (!(await hasRecentEvent(notificationType, roomId, fromUser, targetUser))) return json({ error: "No matching recent event" }, 403);

    const subscriptions = await rest(`push_subscriptions?${new URLSearchParams({
      select: "id,endpoint,p256dh_key,auth_key",
      user_id: `eq.${targetUser}`,
    })}`);
    if (!subscriptions.length) return json({ ok: true });

    const webPush = create({ vapidDetails: { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey } });
    const payload = JSON.stringify({
      type: notificationType,
      title: "Privyte",
      body: notificationType === "call" ? "Incoming call" : "New message",
      data: { type: notificationType, fromUser, roomId },
    });

    await Promise.all(subscriptions.map(async (sub: { id: string; endpoint: string; p256dh_key: string; auth_key: string }) => {
      try {
        await webPush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } }, payload);
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await rest(`push_subscriptions?id=eq.${sub.id}`, "DELETE");
        }
      }
    }));
    return json({ ok: true });
  } catch {
    // Do not return or log request bodies, tokens, private keys, or message data.
    return json({ error: "Notification delivery failed" }, 500);
  }
});
