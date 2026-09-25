import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export type Session = { uid: string; login: string; exp: number };
export const COOKIE = 'lb_session';
const MAX_AGE = 60 * 60 * 24 * 30;

export function authMode(): 'github' | 'password' | 'open' | 'none' {
  if (process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET) return 'github';
  if (process.env.APP_PASSWORD) return 'password';
  return process.env.NODE_ENV !== 'production' ? 'open' : 'none';
}
export function passwordAllowed() { return !!process.env.APP_PASSWORD; }

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return Buffer.from(s);
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be set to at least 32 random characters.');
  return Buffer.from('development-only-secret-development-only');
}
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function sign(s: Omit<Session, 'exp'>): string {
  const body = b64(JSON.stringify({ ...s, exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  return body + '.' + b64(createHmac('sha256', secret()).update(body).digest());
}
export function verify(token: string | undefined): Session | null {
  if (!token) return null;
  const [body, sig] = token.split('.'); if (!body || !sig) return null;
  const want = createHmac('sha256', secret()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try { const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session; return s.exp * 1000 > Date.now() ? s : null; } catch { return null; }
}
export async function getSession(): Promise<Session | null> {
  const mode = authMode();
  if (mode === 'open') return { uid: 'dev', login: 'developer', exp: Infinity };
  if (mode === 'none') return null;
  return verify((await cookies()).get(COOKIE)?.value);
}
export const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE };
export function randomToken() { return randomBytes(24).toString('base64url'); }
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Reject cross-site writes (defence in depth on top of SameSite cookies). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin'); if (!origin) return true;
  try { return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); } catch { return false; }
}
export function appUrl(req: Request) { return (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, ''); }
