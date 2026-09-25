/* Server-side calls to the Anthropic Messages API. The key stays on the server. */
export type Turn = { role: 'user' | 'assistant'; content: string };
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

function normalise(turns: Turn[]): Turn[] {
  // The API needs alternating roles starting with the user: merge neighbours with the same role.
  const out: Turn[] = [];
  for (const t of turns) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant') || typeof t.content !== 'string') continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += '\n\n' + t.content; else out.push({ role: t.role, content: t.content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export async function callClaude(turns: Turn[], opts: { stream: boolean; maxTokens?: number; signal?: AbortSignal }) {
  const messages = normalise(turns);
  if (!messages.length || messages[messages.length - 1].role !== 'user') throw Object.assign(new Error('The conversation must end with a user turn.'), { status: 400 });
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: opts.signal,
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY as string, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL(), max_tokens: opts.maxTokens || 1500, stream: opts.stream, messages })
  });
}

/** Turns Anthropic's server-sent events into a plain stream of text. */
export function textStream(upstream: Response): ReadableStream<Uint8Array> {
  const reader = upstream.body!.getReader(), dec = new TextDecoder(), enc = new TextEncoder();
  let buf = '';
  return new ReadableStream({
    async pull(ctl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { ctl.close(); return; }
        buf += dec.decode(value, { stream: true });
        let i, pushed = false;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { ctl.enqueue(enc.encode(ev.delta.text)); pushed = true; }
            if (ev.type === 'error') { ctl.error(new Error(ev.error && ev.error.message || 'AI error')); return; }
          } catch { /* ignore keep-alives */ }
        }
        if (pushed) return;
      }
    },
    cancel() { reader.cancel().catch(() => { }); }
  });
}

/* A small per-user limit so a stuck page cannot run up costs. */
const hits = new Map<string, number[]>();
export function allow(uid: string, perTenMinutes = Number(process.env.AI_REQUESTS_PER_10_MIN || 40)) {
  const now = Date.now(), arr = (hits.get(uid) || []).filter(t => now - t < 600000);
  if (arr.length >= perTenMinutes) { hits.set(uid, arr); return false; }
  arr.push(now); hits.set(uid, arr); return true;
}
