import { NextResponse } from 'next/server';
import { COOKIE } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
