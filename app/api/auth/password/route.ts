import { NextResponse } from 'next/server';
import { COOKIE, cookieOpts, passwordAllowed, safeEqual, sameOrigin, sign } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Password sign-in for a single-person deployment. Data is stored under users/me/. */
export async function POST(req: Request) {
  if (!passwordAllowed() || !sameOrigin(req)) return NextResponse.redirect(new URL('/login', req.url), 303);
  const form = await req.formData();
  const pw = String(form.get('password') || '');
  if (!safeEqual(pw, process.env.APP_PASSWORD as string)) {
    await new Promise(r => setTimeout(r, 800));
    return NextResponse.redirect(new URL('/login?error=' + encodeURIComponent('Wrong password.'), req.url), 303);
  }
  const res = NextResponse.redirect(new URL('/', req.url), 303);
  res.cookies.set(COOKIE, sign({ uid: 'me', login: 'you' }), cookieOpts);
  return res;
}
