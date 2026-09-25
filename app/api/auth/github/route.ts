import { NextResponse } from 'next/server';
import { appUrl, authMode, randomToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Step 1 of GitHub sign-in: send the browser to GitHub with a one-time state value. */
export async function GET(req: Request) {
  if (authMode() !== 'github') return NextResponse.redirect(new URL('/login', req.url));
  const state = randomToken();
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', process.env.GITHUB_OAUTH_CLIENT_ID!);
  u.searchParams.set('redirect_uri', appUrl(req) + '/api/auth/callback');
  u.searchParams.set('state', state);
  u.searchParams.set('scope', 'read:user');
  u.searchParams.set('allow_signup', 'false');
  const res = NextResponse.redirect(u);
  res.cookies.set('lb_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 });
  return res;
}
