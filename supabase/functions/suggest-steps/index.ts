// Supabase Edge Function: "Suggest steps" and "Summarise" on a quest. For steps, the app sends
// the quest's name and its steps' names; this asks Claude for a few next steps and returns them
// for the app to offer. For a summary (mode "summary"), it also sends which steps are ticked or
// waiting (and on whom) and the quest's own summary; this returns a short plain-English summary.
// Needs one secret (Edge Functions > Secrets): ANTHROPIC_API_KEY, from console.anthropic.com.
// Deploy with JWT verification ON (the default): only a signed-in user of this project gets an
// answer, so the key, which stays here and never reaches the app, can't be used by others.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.
// One file, so it can be pasted straight into the Supabase dashboard's editor.
import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.135.0/helpers/zod';
import { z } from 'npm:zod@4.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.117.0';

const MODEL = 'claude-haiku-5-5'; // the small, fast model: a few steps don't need more

const SYSTEM =
  'You help someone break a work task into practical next steps for their to-do list. ' +
  'Suggest 3 to 6 steps, in the order they would be done, each a short instruction under 80 ' +
  'characters. Leave out steps the task already has, and anything vague like "plan" or "review" ' +
  'unless it is a real step. Use British English. If there is nothing sensible to add, return no steps.';

const text = (v: unknown, n: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';

// Only the quest's name and its steps' names are accepted (and sent on), within limits.
// deno-lint-ignore no-explicit-any
function clean(body: any) {
  const quest = text(body && body.quest, 200);
  if (!quest) return null;
  const steps = (Array.isArray(body.steps) ? body.steps : [])
    .slice(0, 50)
    .map((s: unknown) => text(s, 120))
    .filter(Boolean);
  return { quest, steps };
}

// `client`: an Anthropic client; `format`: the structured-output format for { steps: string[] }.
// deno-lint-ignore no-explicit-any
async function suggestSteps(client: any, format: any, { quest, steps }: { quest: string; steps: string[] }) {
  const r = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low', format },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Task: ${quest}\nSteps it already has:\n${steps.length ? steps.map(s => '- ' + s).join('\n') : '(none)'}`,
      },
    ],
  });
  if (r.stop_reason === 'refusal') return { steps: [], note: 'declined' };
  const have = new Set(steps.map(s => s.toLowerCase()));
  const out = ((r.parsed_output && r.parsed_output.steps) || [])
    .map((s: unknown) => text(s, 120))
    .filter((s: string) => s && !have.has(s.toLowerCase()))
    .slice(0, 8);
  return { steps: out };
}

const SUMMARY_SYSTEM =
  'You write a short status summary of a work task for the person doing it, to show under its ' +
  'name on their to-do list. In plain English, in one to three short sentences (under 400 ' +
  'characters in all), say what has been done and what is left or being waited on. Use only ' +
  'what you are given: never invent names, dates or details. Keep anything important from their ' +
  'own summary. No headings or bullet points. Use British English.';

// For a summary: the name, the steps with whether each is ticked or waiting (and on whom), and the
// quest's own summary, within limits.
// deno-lint-ignore no-explicit-any
function cleanSummary(body: any) {
  const quest = text(body && body.quest, 200);
  if (!quest) return null;
  const steps = (Array.isArray(body.steps) ? body.steps : [])
    .slice(0, 50)
    // deno-lint-ignore no-explicit-any
    .map((s: any) => ({
      text: text(s && s.text, 120),
      done: !!(s && s.done),
      waiting: text(s && s.waiting, 80),
    }))
    .filter((s: { text: string }) => s.text);
  return { quest, steps, summary: text(body.summary, 600) };
}

// deno-lint-ignore no-explicit-any
async function summarise(client: any, format: any, input: NonNullable<ReturnType<typeof cleanSummary>>) {
  const lines = input.steps.map(
    s => `- ${s.text}: ${s.done ? 'done' : s.waiting ? 'waiting on ' + s.waiting : 'to do'}`,
  );
  const r = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low', format },
    system: SUMMARY_SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `Task: ${input.quest}\nSteps:\n${lines.length ? lines.join('\n') : '(none)'}\n` +
          `Their own summary so far: ${input.summary || '(none)'}`,
      },
    ],
  });
  if (r.stop_reason === 'refusal') return { summary: '', note: 'declined' };
  return { summary: text(r.parsed_output && r.parsed_output.summary, 600) };
}

const env = (k: string) => Deno.env.get(k) ?? '';
const claude = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
const format = zodOutputFormat(z.object({ steps: z.array(z.string()) }));
const summaryFormat = zodOutputFormat(z.object({ summary: z.string() }));

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
  const body = await req.json().catch(() => null);
  const summary = !!body && body.mode === 'summary';
  const input = summary ? cleanSummary(body) : clean(body);
  if (!input) return reply({ error: 'no quest' }, 400);
  try {
    return reply(
      summary
        ? // deno-lint-ignore no-explicit-any
          await summarise(claude, summaryFormat, input as any)
        : // deno-lint-ignore no-explicit-any
          await suggestSteps(claude, format, input as any),
    );
  } catch (e) {
    // (the reason, for the function's logs; the app only says it couldn't)
    console.error(e);
    return reply({ error: 'failed' }, 502);
  }
});
