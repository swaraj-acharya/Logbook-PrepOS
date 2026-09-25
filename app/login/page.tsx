import { redirect } from 'next/navigation';
import { authMode, getSession, passwordAllowed } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const mode = authMode();
  if (mode === 'open' || (await getSession())) redirect('/');
  const { error } = await searchParams;
  return (
    <main className="login">
      <div className="panel">
        <div className="brand" style={{ margin: 0 }}>Logbook<small>study, recall, retain</small></div>
        {error ? <div className="note red">{error}</div> : null}
        {mode === 'none' ? (
          <div className="note">Sign-in is not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET (with ALLOWED_GITHUB_USERS), or APP_PASSWORD, plus SESSION_SECRET. See the README.</div>
        ) : null}
        {mode === 'github' ? <a className="btn primary lg" href="/api/auth/github">Sign in with GitHub</a> : null}
        {passwordAllowed() ? (
          <form method="post" action="/api/auth/password" className="stack">
            <label className="f">Password<input type="password" name="password" autoComplete="current-password" required /></label>
            <button className={'btn lg' + (mode === 'github' ? '' : ' primary')} type="submit">Sign in</button>
          </form>
        ) : null}
        <p className="tiny muted">Your study data is stored as JSON files in the GitHub repository this app is configured with.</p>
      </div>
    </main>
  );
}
