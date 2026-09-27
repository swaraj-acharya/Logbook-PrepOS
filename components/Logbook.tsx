'use client';
import { useEffect } from 'react';

/**
 * uid: key for this browser's copy. server: account sync through /api/docs and /api/sync is available.
 * sw: register the offline service worker (production builds). ai: the optional AI features are configured.
 */
export type ClientConfig = { uid: string; login: string; ai: boolean; storage: string; canSignOut: boolean; server: boolean; sw: boolean };

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
          <div className="brand">Logbook PrepOS <small>plan, study, recall, practise</small></div>
          <button className="btn primary start" data-a="start-open" id="rail-start">Start study session</button>
          <div id="rail-links" />
          <div className="foot">
            <button className="save-status" id="save-status" data-a="storage-open" title="Where your preparation is saved">Opening…</button>
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
