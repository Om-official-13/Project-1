# Security status and rollout notes

## Current status: NOT end-to-end encrypted

This branch hardens push delivery but does not implement a vetted end-to-end messaging protocol. Do not market the current application as fully E2EE. Existing text messages are stored as plaintext in `messages.text_content`. The current media implementation stores the media key with the ciphertext, which means database access can reveal media. The sender's local vault also currently stores original media bytes. WebRTC encrypts media in transit using browser DTLS-SRTP, but this application does not cryptographically authenticate the remote peer's identity. These limitations remain and must be fixed before claiming E2EE.

## Push changes in this branch

- The notify Edge Function requires an authenticated user and verifies the caller matches `fromUser`.
- It accepts only a canonical two-user room and requires a recent matching message or call offer.
- Client-provided notification text and arbitrary payload data are ignored. Notifications contain generic text only.
- The service role and VAPID private key are read from Edge Function environment secrets, not source code.
- The public `/process` and queue-enqueue behavior was removed. Push delivery now processes only a verified event.
- The service worker displays fixed generic notification text and no longer offers plaintext inline replies.
- `verify_jwt` is enabled. The client sends its current Supabase access token.

## Required Supabase secrets and VAPID rotation

Configure these Edge Function secrets before deployment:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never use in Vite variables)
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (for example a mailto contact)

The VAPID private key previously committed to the repository must be considered compromised. Generate a new VAPID pair, configure the new public key in `src/lib/push.ts` and `public/sw.js`, set both new keys as Supabase secrets, redeploy the function, and have users resubscribe. Remove the old key from git history with a coordinated history rewrite if appropriate; rotation is still required even after history cleanup. Never paste secrets into chat or commit them.

Deploy with `supabase secrets set ...` using values entered locally, then `supabase functions deploy notify`. Do not put secret values in shell history or CI logs. Verify Edge Function JWT verification is enabled in the deployed project.

## E2EE implementation gate

A complete deployment still requires a reviewed, maintained protocol implementation with browser support, authenticated identity/prekey discovery, key-change verification, device/key recovery rules, encrypted message and media storage, strict RLS, authenticated call signaling, and tests. Do not replace these with a home-grown shared AES key or a key stored in Supabase. No public audit status should be inferred merely from using Web Crypto or WebRTC. Evaluate protocol implementations and commission an independent security review before a production E2EE claim.

## Metadata and legacy data

Supabase can still see account IDs, room participants, timestamps, delivery/read state, push endpoints, presence, and call signaling metadata. Existing plaintext data cannot be made retroactively confidential by a code change. Preserve it until users choose deletion, clearly label legacy content as not E2EE, and provide an explicit export/delete/migration plan before changing its schema.

## Verification still required before launch

Run `npm run typecheck`, `npm run lint`, `npm run build`, and the test suite after installing dependencies. Add integration tests for unauthenticated/forged notification requests, cross-user access, generic push payloads, and expired subscriptions. Manually test calls, push delivery, permissions, and browser support on real devices. This repository does not yet include a test suite proving E2EE.
