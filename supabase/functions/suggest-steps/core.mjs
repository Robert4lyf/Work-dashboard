// What "Suggest steps" asks Claude, and what it accepts and returns. Kept apart from index.ts
// (which needs Deno) so it can be checked on its own.
export const MODEL = 'claude-haiku-5-5'; // the small, fast model: a few steps don't need more

export const SYSTEM =
  'You help someone break a work task into practical next steps for their to-do list. ' +
  'Suggest 3 to 6 steps, in the order they would be done, each a short instruction under 80 ' +
  'characters. Leave out steps the task already has, and anything vague like "plan" or "review" ' +
  'unless it is a real step. Use British English. If there is nothing sensible to add, return no steps.';

const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

// Only the quest's name and its steps' names are accepted (and sent on), within limits.
export function clean(body) {
  const quest = text(body && body.quest, 200);
  if (!quest) return null;
  const steps = (Array.isArray(body.steps) ? body.steps : [])
    .slice(0, 50)
    .map(s => text(s, 120))
    .filter(Boolean);
  return { quest, steps };
}

// `client`: an Anthropic client; `format`: the structured-output format for { steps: string[] }.
export async function suggestSteps(client, format, { quest, steps }) {
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
    .map(s => text(s, 120))
    .filter(s => s && !have.has(s.toLowerCase()))
    .slice(0, 8);
  return { steps: out };
}
