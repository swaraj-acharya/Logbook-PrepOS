import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE, appUrl, cookieOpts, safeEqual, sign } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const back = (req: Request, err: string) => NextResponse.redirect(new URL('/login?error=' + encodeURIComponent(err), req.url));

/** Step 2 of GitHub sign-in: check state, swap the code for a token, look up the user, check the allow-list. */
export async function GET(req: Request) {
  const url = new URL(req.url), code = url.searchParams.get('code'), state = url.searchParams.get('state') || '';
  const want = (await cookies()).get('lb_oauth_state')?.value || '';
  if (!code || !want || !safeEqual(state, want)) return back(req, 'Sign-in expired. Try again.');
  const tr = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_OAUTH_CLIENT_ID, client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET, code, redirect_uri: appUrl(req) + '/api/auth/callback' })
  });
  const tok = await tr.json().catch(() => ({}));
  if (!tok.access_token) return back(req, 'GitHub did not complete the sign-in.');
  const ur = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + tok.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'logbook-study-app' } });
  const user = await ur.json().catch(() => ({}));
  if (!user.id || !user.login) return back(req, 'Could not read your GitHub account.');
  const allowed = (process.env.ALLOWED_GITHUB_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(String(user.login).toLowerCase())) return back(req, 'The GitHub account ' + user.login + ' is not on this app’s allow-list.');
  const res = NextResponse.redirect(new URL('/', appUrl(req)));
  res.cookies.set(COOKIE, sign({ uid: 'gh-' + user.id, login: user.login }), cookieOpts);
  res.cookies.set('lb_oauth_state', '', { path: '/', maxAge: 0 });
  return res;
}
