import { getSession } from '@/lib/session';
import { getStore } from '@/lib/storage';
import { errorResponse, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Every data file for the signed-in user, with the version (blob sha) of each. */
export async function GET() {
  const s = await getSession();
  if (!s) return json({ error: 'Not signed in' }, 401);
  try { return json({ docs: await getStore().loadAll(s.uid) }); }
  catch (e) { return errorResponse(e); }
}
