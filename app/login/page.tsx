import { redirect } from 'next/navigation';
import { authMode, getSession, passwordAllowed } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const mode = authMode();
  if (mode === 'open' || mode === 'none' || (await getSession())) redirect('/');
  const { error } = await searchParams;
  return (
    <main className="login">
      <div className="panel">
        <div className="brand" style={{ margin: 0 }}>Logbook PrepOS<small>plan, study, recall, practise</small></div>
        {error ? <div className="note red">{error}</div> : null}
        {mode === 'github' ? <a className="btn primary lg" href="/api/auth/github">Sign in with GitHub</a> : null}
        {passwordAllowed() ? (
          <form method="post" action="/api/auth/password" className="stack">
            <label className="f">Password<input type="password" name="password" autoComplete="current-password" required /></label>
            <button className={'btn lg' + (mode === 'github' ? '' : ' primary')} type="submit">Sign in</button>
          </form>
        ) : null}
        <p className="tiny muted">Signing in turns on account sync: a copy of your preparation is also kept in the storage this app is configured with. Your preparation file on your computer stays the main copy.</p>
      </div>
    </main>
  );
}
