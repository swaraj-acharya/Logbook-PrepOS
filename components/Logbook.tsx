'use client';
import { useEffect } from 'react';

export type ClientConfig = { uid: string; login: string; ai: boolean; storage: string; canSignOut: boolean };

/* The shell below is filled in by client/ui.js, which renders views into #main, #dock, #tabbar and the overlays. */
export default function Logbook({ config }: { config: ClientConfig }) {
  useEffect(() => {
    let cancelled = false;
    import('@/client/ui.js').then(m => { if (!cancelled) m.mountLogbook(config); });
    return () => { cancelled = true; };
  }, [config]);
  return (
    <>
      <div className="app">
        <nav className="rail" aria-label="Main">
          <div className="brand">Logbook <small>study, recall, retain</small></div>
          <button className="btn primary start" data-a="start-open" id="rail-start">Start study session</button>
          <div id="rail-links" />
          <div className="foot">
            <span id="save-status">Opening…</span>
            <span id="ai-status" />
            {config.canSignOut ? <a href="/api/auth/logout">Sign out{config.login && config.login !== 'you' ? ' ' + config.login : ''}</a> : null}
          </div>
        </nav>
        <div className="main-wrap">
          <div id="dock" />
          <main id="main" tabIndex={-1} />
        </div>
      </div>
      <nav className="tabbar" id="tabbar" aria-label="Main" />
      <div id="modal-root" />
      <div id="focus-root" />
      <div id="toast" role="status" aria-live="polite" />
    </>
  );
}
