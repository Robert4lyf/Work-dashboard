// Supabase Edge Function: sends due notifications. Called every minute by the job in
// supabase/notifications-cron.sql. Needs these secrets (Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  - from Settings > Notifications > Generate keys
//   VAPID_SUBJECT                        - mailto: plus your email, e.g. mailto:me@example.com
//   CRON_SECRET                          - any long random string, also used in the cron job
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// Deploy with JWT verification turned off; the CRON_SECRET header protects it instead.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendDue } from './core.mjs';

const env = (k: string) => Deno.env.get(k) ?? '';
webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

Deno.serve(async req => {
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET'))
    return new Response('forbidden', { status: 403 });
  try {
    return Response.json(await sendDue({ db, push: webpush }));
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
