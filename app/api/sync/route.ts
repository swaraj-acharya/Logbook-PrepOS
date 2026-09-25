import { getSession, sameOrigin } from '@/lib/session';
import { getStore } from '@/lib/storage';
import { DOC_ID, type Change } from '@/lib/storage/types';
import { errorResponse, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_DOC = 2_000_000, MAX_REQ = 4_000_000, MAX_DOCS = 60;

/** Save a batch of changed files as one commit. Body: { changes: { [docId]: { body | null, baseSha } } } */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Cross-site request refused' }, 403);
  const s = await getSession();
  if (!s) return json({ error: 'Not signed in' }, 401);
  const raw = await req.text();
  if (raw.length > MAX_REQ) return json({ error: 'Too much data in one save' }, 413);
  let input: { changes?: Record<string, Change> };
  try { input = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const changes = input && input.changes;
  if (!changes || typeof changes !== 'object') return json({ error: 'Missing changes' }, 400);
  const ids = Object.keys(changes);
  if (!ids.length) return json({ saved: {}, conflicts: {} });
  if (ids.length > MAX_DOCS) return json({ error: 'Too many files in one save' }, 413);
  for (const id of ids) {
    const c = changes[id];
    if (!DOC_ID.test(id)) return json({ error: 'Bad file id: ' + id }, 400);
    if (!c || (c.body !== null && (typeof c.body !== 'object' || Array.isArray(c.body)))) return json({ error: 'Bad body for ' + id }, 400);
    if (c.baseSha != null && !/^[0-9a-f]{40}$/.test(c.baseSha)) return json({ error: 'Bad version for ' + id }, 400);
    if (c.body && JSON.stringify(c.body).length > MAX_DOC) return json({ error: id + ' is too large' }, 413);
  }
  try { return json(await getStore().apply(s.uid, changes)); }
  catch (e) { return errorResponse(e); }
}
