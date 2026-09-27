/*
 * The preparation file on the user's computer (browser side).
 *
 * - The file is the portable source of truth. The browser keeps a recovery copy (IndexedDB) and a working copy
 *   (localStorage, see client/ui.js) so nothing is lost if a save fails or permission lapses.
 * - Chromium browsers get a linked file through the File System Access API: create, open, autosave, reconnect.
 *   The handle is remembered in IndexedDB. The page never learns the folder path, and never claims to.
 * - Other browsers: open a copy (upload) and download copies; data stays in this browser in between.
 * - A file that cannot be read is never overwritten automatically.
 */
import { docsToWorkspace, fingerprint, parseWorkspaceText, serializeWorkspace, workspaceToDocs, WorkspaceError, type Docs } from '../workspace';
import type { PrepWorkspace, SaveState, StorageMeta } from '../types';
import { withDayLog } from '../daylog';

/* ------------------------------------------------------------------ small key-value store */

export type KV = { get<T = any>(k: string): Promise<T | undefined>; set(k: string, v: unknown): Promise<void>; del(k: string): Promise<void> };
export function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return { async get(k) { return m.get(k) as any; }, async set(k, v) { m.set(k, v); }, async del(k) { m.delete(k); } };
}
/** IndexedDB, falling back to memory when it is unavailable (private windows, very old browsers). */
export function idbKV(dbName = 'logbook-prepos', store = 'kv'): KV {
  const idb: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined;
  if (!idb) return memoryKV();
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = idb.open(dbName, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await db();
    return new Promise((res, rej) => { const t = d.transaction(store, mode); const q = fn(t.objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  };
  return {
    async get(k) { try { return await tx('readonly', s => s.get(k)) as any; } catch { return undefined; } },
    async set(k, v) { await tx('readwrite', s => s.put(v, k)); },
    async del(k) { await tx('readwrite', s => s.delete(k)); }
  };
}

/* ------------------------------------------------------------------ file handles */

export type WritableLike = { write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> };
export type FileLike = { text(): Promise<string>; lastModified: number; size: number; name?: string };
export type FileHandleLike = { name: string; kind?: string; getFile(): Promise<FileLike>; createWritable(): Promise<WritableLike>;
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>; requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState> };
export type Pickers = { save(suggestedName: string): Promise<FileHandleLike>; open(): Promise<FileHandleLike> };

const TYPES = [{ description: 'Preparation file', accept: { 'application/json': ['.json'] } }];
/** The browser's pickers, or null when the File System Access API is missing. */
export function browserPickers(): Pickers | null {
  const w: any = typeof window !== 'undefined' ? window : null;
  if (!w || typeof w.showSaveFilePicker !== 'function' || typeof w.showOpenFilePicker !== 'function') return null;
  return {
    save: (suggestedName: string) => w.showSaveFilePicker({ suggestedName, types: TYPES, id: 'prep-file' }),
    open: async () => (await w.showOpenFilePicker({ types: TYPES, multiple: false, id: 'prep-file' }))[0]
  };
}
export function safeFileName(name: string): string {
  const base = String(name || 'my-preparation').normalize('NFKD').replace(/[^\w\s.-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'my-preparation';
  return /\.json$/i.test(base) ? base : base + '-progress.json';
}
function errState(e: any): { state: SaveState; message: string } {
  const n = e && e.name;
  if (n === 'NotFoundError') return { state: 'unavailable', message: 'The file was moved, renamed or deleted.' };
  if (n === 'NotAllowedError' || n === 'SecurityError') return { state: 'permission', message: 'The browser needs your permission to save to the file again.' };
  if (n === 'QuotaExceededError') return { state: 'failed', message: 'The disk is full.' };
  if (n === 'NoModificationAllowedError' || n === 'InvalidStateError') return { state: 'failed', message: 'The file is locked by another program.' };
  return { state: 'failed', message: (e && e.message) || 'The file could not be written.' };
}

/* ------------------------------------------------------------------ the sync controller */

export type FileSyncStatus = { state: SaveState; fileName: string | null; message: string; lastSavedAt: number | null; supported: boolean; dirty: boolean };
export type OpenResult = { ws: PrepWorkspace; docs: Docs; warnings: string[]; source: string; text: string; handle: FileHandleLike | null; name: string; empty?: boolean };
export type FileSyncDeps = {
  kv: KV; pickers: Pickers | null;
  getDocs(): Docs;
  /** Puts docs into the app: 'merge' when the file is the same preparation, 'replace' when switching preparations. */
  applyDocs(docs: Docs, mode: 'merge' | 'replace'): void;
  workspaceId(): string;
  onStatus(s: FileSyncStatus): void;
  debounceMs?: number; now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void;
};

export class FileSync {
  handle: FileHandleLike | null = null;
  meta: StorageMeta | null = null;
  state: SaveState = 'nofile';
  message = '';
  dirty = false;
  lastSavedAt: number | null = null;
  private timer: unknown = null; private recTimer: unknown = null;
  private writing: Promise<void> | null = null; private again = false;
  private lastWritten = '';
  constructor(private d: FileSyncDeps) { }
  private now() { return this.d.now ? this.d.now() : Date.now(); }
  private set(state: SaveState, message = '') { this.state = state; this.message = message; this.emit(); }
  status(): FileSyncStatus { return { state: this.state, fileName: this.handle ? this.handle.name : this.meta ? this.meta.fileName : null, message: this.message, lastSavedAt: this.lastSavedAt, supported: !!this.d.pickers, dirty: this.dirty }; }
  private emit() { try { this.d.onStatus(this.status()); } catch { /* UI errors never block saving */ } }
  private later(fn: () => void, ms: number) { return (this.d.setTimer || ((f, m) => setTimeout(f, m)))(fn, ms); }
  private cancel(t: unknown) { if (t != null) (this.d.clearTimer || ((x: any) => clearTimeout(x)))(t); }

  /** On start: reconnect the remembered file if the browser still allows it. */
  async init(): Promise<FileSyncStatus> {
    try { this.meta = (await this.d.kv.get<StorageMeta>('fileMeta')) || null; this.handle = (await this.d.kv.get<FileHandleLike>('fileHandle')) || null; } catch { this.handle = null; }
    if (this.meta && this.meta.lastSavedAt) this.lastSavedAt = this.meta.lastSavedAt;
    if (!this.handle) { this.set('nofile', ''); return this.status(); }
    const perm = await this.permission(false);
    if (perm !== 'granted') { this.set('permission', 'Reconnect the preparation file to keep saving to it. Your changes are safe in this browser meanwhile.'); return this.status(); }
    await this.loadLinked();
    return this.status();
  }
  private async permission(request: boolean): Promise<PermissionState> {
    const h = this.handle; if (!h) return 'denied';
    try {
      if (h.queryPermission) { const q = await h.queryPermission({ mode: 'readwrite' }); if (q === 'granted' || !request) return q; }
      if (request && h.requestPermission) return await h.requestPermission({ mode: 'readwrite' });
      return h.queryPermission ? 'prompt' : 'granted';
    } catch { return 'denied'; }
  }
  /** Must run from a click (the browser asks the user). */
  async reconnect(): Promise<boolean> {
    if (!this.handle) return false;
    const p = await this.permission(true);
    if (p !== 'granted') { this.set('permission', 'Permission was not granted. Your changes are still safe in this browser.'); return false; }
    await this.loadLinked(); if (this.dirty) await this.flush();
    return this.state === 'saved';
  }
  /** Reads the linked file and merges it with what this browser has (same preparation) or loads it (different one). */
  async loadLinked(): Promise<void> {
    const h = this.handle; if (!h) return;
    let text: string, file: FileLike;
    try { file = await h.getFile(); text = await file.text(); } catch (e) { const s = errState(e); this.set(s.state, s.message); return; }
    let parsed;
    try { parsed = parseWorkspaceText(text); }
    catch (e) {
      this.set('blocked', (e instanceof WorkspaceError ? e.message : 'The file could not be read.') + ' It will not be overwritten. Save your current data to a new file, or open another file.');
      return;
    }
    const docs = workspaceToDocs(parsed.ws);
    const same = parsed.ws.workspaceId === this.d.workspaceId();
    if (!same) await this.saveRecovery();          // what this browser had is kept before the file's preparation replaces it
    this.d.applyDocs(docs, same ? 'merge' : 'replace');
    this.lastWritten = text;
    await this.remember(h, { lastModified: file.lastModified, lastSize: file.size });
    const now = this.serialize();
    this.dirty = fingerprint(stripSaved(now)) !== fingerprint(stripSaved(text));
    this.set(this.dirty ? 'unsaved' : 'saved', '');
    if (this.dirty) this.schedule(300);
  }
  /** The file text: all data plus the readable overview and day-by-day records (lib/daylog.ts). */
  private serialize(): string { const now = this.now(); return serializeWorkspace(withDayLog(docsToWorkspace(this.d.getDocs(), { now }), now)); }
  private async remember(h: FileHandleLike, extra: Partial<StorageMeta> = {}) {
    this.meta = { ...(this.meta || {}), workspaceId: this.d.workspaceId(), fileName: h.name, linkedAt: (this.meta && this.meta.linkedAt) || this.now(), ...extra } as StorageMeta;
    try { await this.d.kv.set('fileHandle', h); } catch { /* some browsers cannot store handles; the link lasts this session */ }
    try { await this.d.kv.set('fileMeta', this.meta); } catch { /* ignore */ }
  }

  /** Something changed in the app. */
  markDirty(): void {
    this.dirty = true;
    this.scheduleRecovery();
    if (!this.handle) { if (this.state !== 'nofile') this.set('nofile', ''); else this.emit(); return; }
    if (this.state === 'saved' || this.state === 'idle') this.set('unsaved', '');
    this.schedule(this.d.debounceMs ?? 1500);
  }
  schedule(ms: number) { this.cancel(this.timer); this.timer = this.later(() => { this.timer = null; void this.flush(); }, ms); }
  private scheduleRecovery() {
    this.cancel(this.recTimer);
    this.recTimer = this.later(() => { this.recTimer = null; void this.saveRecovery(); }, 1200);
  }
  async saveRecovery(): Promise<void> {
    try {
      const rec = { at: this.now(), docs: this.d.getDocs() };
      await this.d.kv.set('recovery:' + this.d.workspaceId(), rec); await this.d.kv.set('recovery:last', rec);
    } catch { /* the localStorage copy remains */ }
  }
  async recovery(workspaceId: string): Promise<{ at: number; docs: Docs } | undefined> { try { return await this.d.kv.get('recovery:' + workspaceId); } catch { return undefined; } }

  /** Writes pending changes to the linked file. Safe to call often: clean state is not rewritten; concurrent calls coalesce. */
  async flush(force = false): Promise<void> {
    if (!this.handle) { this.set('nofile', ''); return; }
    if (this.state === 'blocked') return;
    if (!force && !this.dirty && this.state === 'saved') return;
    if (this.writing) { this.again = true; return this.writing; }
    this.writing = this.write().finally(() => { this.writing = null; if (this.again) { this.again = false; void this.flush(); } });
    return this.writing;
  }
  private async write(): Promise<void> {
    const h = this.handle!;
    const perm = await this.permission(false);
    if (perm !== 'granted') { this.set('permission', 'Your changes are still safe in this browser. Reconnect the preparation file to save them.'); return; }
    this.set('saving', '');
    try {
      const f = await h.getFile();
      if (this.meta && (f.lastModified !== this.meta.lastModified || f.size !== this.meta.lastSize)) {
        const text = await f.text();
        if (text !== this.lastWritten) {
          let parsed;
          try { parsed = parseWorkspaceText(text); }
          catch { this.set('blocked', 'The file was changed outside Logbook and can no longer be read, so it was not overwritten. Save to a new file to keep your data.'); return; }
          if (parsed.ws.workspaceId !== this.d.workspaceId()) { this.set('blocked', 'The file now holds a different preparation, so it was not overwritten. Save to a new file or open that file.'); return; }
          this.d.applyDocs(workspaceToDocs(parsed.ws), 'merge');
          this.message = 'The file was changed outside Logbook; both versions were merged and nothing was deleted.';
        }
      }
      const out = this.serialize();
      const w = await h.createWritable();
      try { await w.write(out); await w.close(); } catch (e) { try { if (w.abort) await w.abort(); } catch { /* ignore */ } throw e; }
      this.lastWritten = out; this.dirty = false; this.lastSavedAt = this.now();
      let stat: FileLike | null = null; try { stat = await h.getFile(); } catch { stat = null; }
      await this.remember(h, { lastSavedAt: this.lastSavedAt, lastModified: stat ? stat.lastModified : this.now(), lastSize: stat ? stat.size : out.length });
      const note = this.message; this.set('saved', note && /merged/.test(note) ? note : '');
    } catch (e) {
      const s = errState(e);
      this.set(s.state, s.state === 'failed' || s.state === 'unavailable' ? s.message + ' Your changes are still safe in this browser.' : s.message);
      if (s.state === 'failed') this.schedule(15000);
    }
  }

  /** "Save now": writes even when nothing changed (asks for permission first if needed; call from a click). */
  async saveNow(): Promise<void> {
    if (this.handle && this.state === 'permission') { const ok = await this.reconnect(); if (!ok && (this.state as SaveState) !== 'unsaved') return; }
    this.cancel(this.timer); await this.flush(true);
  }
  /** Asks where to save a new file. Returns null when cancelled or unsupported. Call first thing in a click handler. */
  async pick(suggestedName: string): Promise<FileHandleLike | null> {
    if (!this.d.pickers) return null;
    try { return await this.d.pickers.save(safeFileName(suggestedName)); } catch (e: any) { if (e && e.name === 'AbortError') return null; throw e; }
  }
  /** Creates a new file (or uses one already picked) and links it. Call from a click. */
  async createNew(suggestedName: string, picked?: FileHandleLike | null): Promise<boolean> {
    const h = picked || await this.pick(suggestedName);
    if (!h) return false;
    this.handle = h; this.meta = null; this.lastWritten = ''; this.dirty = true;
    await this.remember(h, {});
    this.state = 'unsaved';
    await this.flush();
    return (this.state as SaveState) === 'saved';
  }
  /** Lets the user pick a file and reads it without changing anything yet. */
  async pickAndRead(): Promise<OpenResult | null> {
    if (!this.d.pickers) return null;
    let h: FileHandleLike;
    try { h = await this.d.pickers.open(); } catch (e: any) { if (e && e.name === 'AbortError') return null; throw e; }
    const f = await h.getFile(); const text = await f.text();
    // An empty file (for example one made with `touch progress/progress.json`) is linked and filled with the current preparation.
    if (!text.trim() || /^\s*\{\s*\}\s*$/.test(text)) return { ws: docsToWorkspace(this.d.getDocs()), docs: {}, warnings: [], source: 'empty', text, handle: h, name: h.name, empty: true };
    return { ...readText(text), handle: h, name: h.name };
  }
  /** Switches to a file the user picked (after they confirmed). */
  async commitOpen(r: OpenResult): Promise<void> {
    this.cancel(this.timer);
    if (r.empty && r.handle) {
      if (r.handle.requestPermission) { try { await r.handle.requestPermission({ mode: 'readwrite' }); } catch { /* reported by the write */ } }
      await this.createNew(r.name, r.handle); return;
    }
    // A file chosen in the open dialog is readable only; ask for write access now, while the click still counts.
    if (r.handle && r.handle.requestPermission) { try { await r.handle.requestPermission({ mode: 'readwrite' }); } catch { /* handled as 'permission' below */ } }
    const sameWs = r.ws.workspaceId === this.d.workspaceId();
    if (!sameWs) await this.saveRecovery();
    this.d.applyDocs(r.docs, sameWs ? 'merge' : 'replace');
    if (r.handle) {
      this.handle = r.handle; this.meta = null; this.lastWritten = r.text;
      const f = await r.handle.getFile();
      await this.remember(r.handle, { lastModified: f.lastModified, lastSize: f.size });
      const now = this.serialize();
      this.dirty = r.source !== 'v2' || fingerprint(stripSaved(now)) !== fingerprint(stripSaved(r.text));
      if ((await this.permission(false)) !== 'granted') { this.set('permission', 'Allow saving to this file to keep it up to date. Your changes are safe in this browser meanwhile.'); return; }
      this.set(this.dirty ? 'unsaved' : 'saved', r.source !== 'v2' ? 'Converted to the new preparation format; the file will be updated.' : '');
      if (this.dirty) this.schedule(400);
    } else if (sameWs && this.handle) {
      // A copy of the linked preparation (an upload or an old backup of it): merged in, and the linked file is brought up to date.
      this.dirty = true; this.set('unsaved', 'The copy was merged into this preparation; its file will be updated.'); this.schedule(400);
    } else {
      // A different preparation from an upload: the previously linked file belongs to the old one, so it is unlinked (never overwritten).
      if (this.handle) { this.handle = null; this.meta = null; try { await this.d.kv.del('fileHandle'); await this.d.kv.del('fileMeta'); } catch { /* ignore */ } }
      this.dirty = true; this.set('nofile', 'Opened a copy. Changes are kept in this browser until you save them to a file.');
    }
    void this.saveRecovery();
  }
  /** Stops using the linked file (the file itself is untouched). */
  async forget(): Promise<void> {
    this.cancel(this.timer); this.handle = null; this.meta = null;
    try { await this.d.kv.del('fileHandle'); await this.d.kv.del('fileMeta'); } catch { /* ignore */ }
    this.set('nofile', '');
  }
  /** The current preparation as file text, for "Export a copy". */
  exportText(): string { return this.serialize(); }
}

export function readText(text: string): { ws: PrepWorkspace; docs: Docs; warnings: string[]; source: string; text: string } {
  const r = parseWorkspaceText(text);
  return { ws: r.ws, docs: workspaceToDocs(r.ws), warnings: r.warnings, source: r.source, text };
}
/** savedAt and the overview's generatedAt change on every write; ignore them when asking whether the content changed. */
function stripSaved(text: string): string { return text.replace(/"savedAt":\s*"[^"]*"/, '').replace(/"generatedAt":\s*"[^"]*"/, ''); }
