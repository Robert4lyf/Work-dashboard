// Supabase Edge Function: "Suggest steps" on a quest. The app sends the quest's name and its
// steps' names; this asks Claude for a few next steps and returns them for the app to offer.
// Needs one secret (Edge Functions > Secrets): ANTHROPIC_API_KEY, from console.anthropic.com.
// Deploy with JWT verification ON (the default): only a signed-in user of this project gets an
// answer, so the key, which stays here and never reaches the app, can't be used by others.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.
import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.135.0/helpers/zod';
import { z } from 'npm:zod@4.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.117.0';
import { clean, suggestSteps } from './core.mjs';

const env = (k: string) => Deno.env.get(k) ?? '';
const claude = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
const format = zodOutputFormat(z.object({ steps: z.array(z.string()) }));

// The app is served from another origin (GitHub Pages), so the browser asks first.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method' }, 405);
  // A signed-in user, not just the public key (which also passes JWT verification).
  const auth = req.headers.get('authorization') ?? '';
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: auth } },
  });
  const { data } = await db.auth.getUser(auth.replace(/^Bearer /i, ''));
  if (!data?.user) return reply({ error: 'sign in' }, 401);
  if (!env('ANTHROPIC_API_KEY')) return reply({ error: 'no key' }, 500);
  const input = clean(await req.json().catch(() => null));
  if (!input) return reply({ error: 'no quest' }, 400);
  try {
    return reply(await suggestSteps(claude, format, input));
  } catch (e) {
    // (the reason, for the function's logs; the app only says it couldn't)
    console.error(e);
    return reply({ error: 'failed' }, 502);
  }
});
