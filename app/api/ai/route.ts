import { getSession, sameOrigin } from '@/lib/session';
import { aiEnabled, allow, callClaude, textStream, type Turn } from '@/lib/ai';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Body: { messages: Turn[], json?: boolean }. Streams plain text, or returns { text } when json is set. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Cross-site request refused' }, 403);
  const s = await getSession();
  if (!s) return json({ error: 'Not signed in' }, 401);
  if (!aiEnabled()) return json({ error: 'AI is not configured on this server' }, 501);
  const raw = await req.text();
  if (raw.length > 80_000) return json({ error: 'Request too large' }, 413);
  let body: { messages?: Turn[]; json?: boolean };
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: 'No messages' }, 400);
  if (!allow(s.uid)) return json({ error: 'Too many AI requests. Try again in a few minutes.' }, 429);
  let up: Response;
  try { up = await callClaude(body.messages, { stream: !body.json, maxTokens: body.json ? 2000 : 1500, signal: req.signal }); }
  catch (e: any) { return json({ error: e?.message || 'AI request failed' }, e?.status || 502); }
  if (!up.ok) {
    const t = await up.text();
    let msg = 'AI request failed'; try { msg = JSON.parse(t).error.message || msg; } catch { }
    return json({ error: msg }, up.status === 429 || up.status === 529 ? 429 : 502);
  }
  if (body.json) {
    const d = await up.json();
    return json({ text: (d.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') });
  }
  return new Response(textStream(up), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}
