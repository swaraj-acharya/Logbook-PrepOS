// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { FileSync, memoryKV, safeFileName, readText } from '../lib/storage/local-file';
import { newCore, docsToWorkspace, serializeWorkspace } from '../lib/workspace';
import { mergeDoc } from '../lib/merge.js';
import { withDayLog } from '../lib/daylog';

function fakeHandle(name, text = '') {
  const h = { name, text, mtime: 1, perm: 'granted', writes: 0, failNext: null,
    async getFile() { if (h.missing) throw Object.assign(new Error('gone'), { name: 'NotFoundError' }); return { text: async () => h.text, lastModified: h.mtime, size: h.text.length }; },
    async createWritable() { let buf = ''; return { write: async d => { buf += d; }, close: async () => { if (h.failNext) { const e = h.failNext; h.failNext = null; throw e; } h.text = buf; h.mtime++; h.writes++; } }; },
    async queryPermission() { return h.perm; }, async requestPermission() { if (h.grantOnRequest) h.perm = 'granted'; return h.perm; } };
  return h;
}
function app(initial) {
  let docs = initial || { core: newCore({ activeExamId: null }) };
  const statuses = [], timers = [];
  const deps = { kv: memoryKV(), pickers: null, getDocs: () => docs, workspaceId: () => docs.core.wsid,
    applyDocs(d, mode) { if (mode === 'replace') docs = d; else { const out = { ...docs }; for (const k of new Set([...Object.keys(docs), ...Object.keys(d)])) out[k] = mergeDoc(k, docs[k], d[k]); docs = out; } },
    onStatus: s => statuses.push(s), setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => { } };
  const fs = new FileSync(deps);
  return { fs, deps, statuses, timers, get docs() { return docs; }, set docs(v) { docs = v; }, run: async () => { while (timers.length) { const t = timers.shift(); await t.fn(); } await fs.flush(); } };
}

describe('preparation file on disk', () => {
  it('creates a new file from the current data and remembers it', async () => {
    const a = app(); const h = fakeHandle('x');
    a.deps.pickers = { save: async () => h, open: async () => h };
    a.docs.core.exams.push({ id: 'e1', name: 'CAT 2027', date: '2027-11-28' });
    expect(await a.fs.createNew('CAT 2027')).toBe(true);
    expect(a.fs.status()).toMatchObject({ state: 'saved', fileName: 'x', dirty: false });
    const saved = JSON.parse(h.text);
    expect(saved.schemaVersion).toBe(2); expect(saved.exam.name).toBe('CAT 2027');
    expect(await a.deps.kv.get('fileHandle')).toBe(h);
    expect((await a.deps.kv.get('fileMeta')).fileName).toBe('x');
    expect(safeFileName('CAT 2027')).toBe('CAT-2027-progress.json');
  });
  it('autosaves after a pause, showing unsaved, saving and saved', async () => {
    const a = app(); const h = fakeHandle('p.json'); a.deps.pickers = { save: async () => h };
    await a.fs.createNew('p'); const before = h.writes;
    a.docs.core.nodes.push({ id: 's', kind: 'subject', name: 'Quant', order: 0 }); a.fs.markDirty();
    a.docs.core.nodes.push({ id: 't', kind: 'subject', name: 'VARC', order: 1 }); a.fs.markDirty();
    expect(a.fs.status().state).toBe('unsaved');
    expect(h.writes).toBe(before);                                  // nothing written on every keystroke
    await a.run();
    expect(h.writes).toBe(before + 1);                               // one debounced write
    expect(a.statuses.map(s => s.state)).toEqual(expect.arrayContaining(['unsaved', 'saving', 'saved']));
    expect(JSON.parse(h.text).subjects.map(s => s.name)).toEqual(['Quant', 'VARC']);
  });
  it('reconnects a remembered file on start, and asks for permission when the browser requires it', async () => {
    const first = app(); const h = fakeHandle('prep.json'); first.deps.pickers = { save: async () => h };
    first.docs.core.exams.push({ id: 'e', name: 'UPSC' }); await first.fs.createNew('prep');
    const second = app(); second.deps.kv = first.deps.kv; second.fs = new FileSync(second.deps);
    await second.fs.init();
    expect(second.fs.status().state).toBe('saved'); expect(second.docs.core.exams[0].name).toBe('UPSC');
    h.perm = 'prompt';
    const third = app(); third.deps.kv = first.deps.kv; third.fs = new FileSync(third.deps);
    await third.fs.init();
    expect(third.fs.status().state).toBe('permission');
    h.grantOnRequest = true;
    expect(await third.fs.reconnect()).toBe(true);
  });
  it('keeps changes safe in the browser when permission is lost or writing fails, and retries', async () => {
    const a = app(); const h = fakeHandle('p.json'); a.deps.pickers = { save: async () => h };
    await a.fs.createNew('p');
    h.perm = 'prompt'; a.docs.core.nodes.push({ id: 'n', kind: 'subject', name: 'A', order: 0 }); a.fs.markDirty(); await a.run();
    expect(a.fs.status().state).toBe('permission'); expect(a.fs.status().dirty).toBe(true);
    expect(a.fs.status().message).toMatch(/still safe in this browser/);
    const rec = await a.fs.recovery(a.docs.core.wsid);
    expect(rec.docs.core.nodes.length).toBe(1);                      // browser recovery copy exists
    h.perm = 'granted'; h.failNext = Object.assign(new Error('disk'), { name: 'QuotaExceededError' });
    await a.fs.flush();
    expect(a.fs.status().state).toBe('failed'); expect(a.fs.status().message).toMatch(/disk is full.*still safe/);
    await a.fs.flush();
    expect(a.fs.status().state).toBe('saved');
    h.missing = true; a.fs.markDirty(); await a.run();
    expect(a.fs.status().state).toBe('unavailable');
  });
  it('merges changes made to the file outside the app instead of overwriting them', async () => {
    const a = app(); const h = fakeHandle('p.json'); a.deps.pickers = { save: async () => h };
    await a.fs.createNew('p');
    const outside = JSON.parse(h.text);
    outside.sessions.push({ id: 'phone', subjectId: null, conceptIds: [], startedAt: 1e12, endedAt: 1e12 + 60000, focusSec: 60, elapsedSec: 60, pausedSec: 0, breakSec: 0, idleExcludedSec: 0, mode: 'reading', source: 'manual', status: 'completed' });
    h.text = JSON.stringify(outside); h.mtime += 5;
    a.docs.core.nodes.push({ id: 'n', kind: 'subject', name: 'Mine', order: 0 }); a.docs.core.updatedAt = Date.now(); a.fs.markDirty(); await a.run();
    const final = JSON.parse(h.text);
    expect(final.sessions.map(s => s.id)).toEqual(['phone']);
    expect(final.subjects.map(s => s.name)).toEqual(['Mine']);
    expect(a.fs.status().message).toMatch(/merged/);
  });
  it('never overwrites a file it cannot read', async () => {
    const a = app(); const h = fakeHandle('p.json', '{ "schemaVersion": 2, "exams": [');
    await a.deps.kv.set('fileHandle', h); await a.deps.kv.set('fileMeta', { fileName: 'p.json', workspaceId: 'x', linkedAt: 1 });
    await a.fs.init();
    expect(a.fs.status().state).toBe('blocked'); expect(a.fs.status().message).toMatch(/not valid JSON.*will not be overwritten/);
    a.fs.markDirty(); await a.run();
    expect(h.text).toBe('{ "schemaVersion": 2, "exams": [');
  });
  it('opens another preparation (replacing) or the same one (merging), and converts old backups', async () => {
    const other = newCore({}); other.exams.push({ id: 'z', name: 'Cloud certification' });
    const text = serializeWorkspace(withDayLog(docsToWorkspace({ core: other })));      // as the app writes it
    const a = app(); const h = fakeHandle('cloud.json', text);
    a.deps.pickers = { open: async () => h, save: async () => h };
    const r = await a.fs.pickAndRead();
    expect(r.ws.exam.name).toBe('Cloud certification');
    await a.fs.commitOpen(r);
    expect(a.docs.core.wsid).toBe(other.wsid); expect(a.fs.status().state).toBe('saved');
    const legacy = readText(JSON.stringify({ app: 'logbook', v: 1, docs: { core: { v: 1, settings: {}, exams: [{ id: 'g', name: 'Old' }], nodes: [], mem: {} } } }));
    expect(legacy.source).toBe('v1-backup'); expect(legacy.docs.core.v).toBe(2);
  });
  it('links an empty file and fills it with the current preparation', async () => {
    const a = app(); const h = fakeHandle('progress.json', ''); a.deps.pickers = { open: async () => h, save: async () => h };
    a.docs.core.exams.push({ id: 'e', name: 'Law entrance' }); const wsid = a.docs.core.wsid;
    const r = await a.fs.pickAndRead(); expect(r.empty).toBe(true);
    await a.fs.commitOpen(r);
    expect(a.docs.core.wsid).toBe(wsid);                                   // nothing was replaced
    expect(a.fs.status()).toMatchObject({ state: 'saved', fileName: 'progress.json' });
    const saved = JSON.parse(h.text); expect(saved.exam.name).toBe('Law entrance'); expect(saved.overview).toBeTruthy(); expect(saved.days).toEqual({});
  });
  it('unlinks the current file when an uploaded copy of a different preparation is opened, so the old file is never overwritten', async () => {
    const a = app(); const h = fakeHandle('physics.json'); a.deps.pickers = { save: async () => h };
    a.docs.core.exams.push({ id: 'p', name: 'Physics finals' });
    await a.fs.createNew('physics'); const physics = h.text, wsid = a.docs.core.wsid;
    const upload = readText(JSON.stringify({ app: 'logbook', v: 1, docs: { core: { v: 1, settings: {}, exams: [{ id: 'g', name: 'Old exam' }], nodes: [], mem: {} } } }));
    await a.fs.commitOpen({ ...upload, handle: null, name: 'old.json' });
    expect(a.docs.core.wsid).not.toBe(wsid);
    expect(a.fs.status()).toMatchObject({ state: 'nofile', fileName: null });
    expect(await a.deps.kv.get('fileHandle')).toBeUndefined();
    a.docs.core.nodes.push({ id: 's', kind: 'subject', name: 'Later edit', order: 0 }); a.fs.markDirty(); await a.run();
    expect(h.text).toBe(physics);                        // the physics file is untouched
    expect(JSON.parse(h.text).exam.name).toBe('Physics finals');
  });
  it('merges an uploaded copy of the same preparation and updates the linked file', async () => {
    const a = app(); const h = fakeHandle('p.json'); a.deps.pickers = { save: async () => h };
    await a.fs.createNew('p');
    const copy = JSON.parse(JSON.stringify(a.docs)); copy.core.nodes.push({ id: 'x', kind: 'subject', name: 'From the copy', order: 0 }); copy.core.updatedAt = Date.now() + 5000;   // the newer core wins
    const r = readText(serializeWorkspace(docsToWorkspace(copy)));
    await a.fs.commitOpen({ ...r, handle: null, name: 'copy.json' });
    expect(a.fs.status().fileName).toBe('p.json'); await a.run();
    expect(JSON.parse(h.text).nodes.some(n => n.name === 'From the copy')).toBe(true);
  });
});
