// Edge function: notify — processes the notification queue and sends Web Push notifications

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// VAPID keys for Web Push
const VAPID_PUBLIC_KEY = "BH3Hu4coQib8isEhGxbX49PUru0tGat_hd9sOtbkdV5q1OUBIdhTissEdAMrmNwVGtfzRoeW_d9dS70PUwh5Dbw";
const VAPID_PRIVATE_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgsSVSUf86+HSQl2lo01duueyKRcc/L4Mcx1tPkLk6fUKhRANCAAR9x7uHKEIm/IrBIRsW1+PT1K7tLRmrf4XfbDrW5HVeatTlASHYU4rLBHQDK5jcFRrX80aHlv3fXUu9D1MIeQ28";

// Import Web Push library
import { create } from "npm:web-push@3.6.7";

create({
  vapidDetails: {
    subject: "mailto:noreply@privyte.app",
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
  },
});

// We use the service role key to bypass RLS for reading subscriptions
// and processing the notification queue
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function processNotificationQueue() {
  // Fetch unprocessed notifications
  const queueRes = await fetch(`${supabaseUrl}/rest/v1/notification_queue?processed=eq.false&order=created_at.asc&limit=50`, {
    headers: {
      "apikey": serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`,
    },
  });
  const queueItems = await queueRes.json();
  if (!queueItems || queueItems.length === 0) return;

  for (const item of queueItems) {
    // Find all push subscriptions for the target user
    const subsRes = await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${item.target_user}`, {
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
    });
    const subscriptions = await subsRes.json();
    if (!subscriptions || subscriptions.length === 0) {
      // No subscriptions — mark as processed
      await fetch(`${supabaseUrl}/rest/v1/notification_queue?id=eq.${item.id}`, {
        method: "PATCH",
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ processed: true }),
      });
      continue;
    }

    for (const sub of subscriptions) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh_key,
          auth: sub.auth_key,
        },
      };

      const payload = JSON.stringify({
        type: item.notification_type,
        title: item.title,
        body: item.body,
        tag: `${item.notification_type}-${item.id}`,
        data: item.data,
      });

      try {
        await create().sendNotification(pushSubscription, payload);
      } catch (error) {
        // If subscription expired (410 Gone), delete it
        if (error.statusCode === 410 || error.statusCode === 404) {
          await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${sub.id}`, {
            method: "DELETE",
            headers: {
              "apikey": serviceRoleKey,
              "Authorization": `Bearer ${serviceRoleKey}`,
            },
          });
        }
      }
    }

    // Mark notification as processed
    await fetch(`${supabaseUrl}/rest/v1/notification_queue?id=eq.${item.id}`, {
      method: "PATCH",
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ processed: true }),
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // Manual trigger endpoint (for testing or cron-like polling)
    if (url.pathname.endsWith("/process")) {
      await processNotificationQueue();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Direct send endpoint — allows the client to trigger notification processing
    if (req.method === "POST") {
      const body = await req.json();

      // Insert into notification queue
      if (body.action === "enqueue") {
        const insertRes = await fetch(`${supabaseUrl}/rest/v1/notification_queue`, {
          method: "POST",
          headers: {
            "apikey": serviceRoleKey,
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
          },
          body: JSON.stringify({
            target_user: body.targetUser,
            from_user: body.fromUser,
            notification_type: body.notificationType,
            title: body.title,
            body: body.body,
            data: body.data || {},
          }),
        });

        if (!insertRes.ok) {
          throw new Error(`Failed to enqueue notification: ${insertRes.status}`);
        }

        // Process the queue immediately
        await processNotificationQueue();

        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Process queue endpoint
      if (body.action === "process") {
        await processNotificationQueue();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
