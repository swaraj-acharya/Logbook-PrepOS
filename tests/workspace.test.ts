// @ts-nocheck
import { describe, it, expect } from 'vitest';
import * as W from '../lib/workspace';
import { mergeDoc } from '../lib/merge.js';

const t = (d, h = 10) => new Date(2026, 8, d, h).getTime();
function v1Docs() {
  return {
    core: { v: 1, settings: { dailyMin: 150, avail: 180, activeExamId: 'e1', retention: 0.9 }, exams: [{ id: 'e1', name: 'GATE EE', date: '2027-02-06' }],
      nodes: [{ id: 'S1', kind: 'subject', name: 'Electric Circuits', order: 0, share: 10, imp: 3 }, { id: 'T1', kind: 'topic', parentId: 'S1', name: 'Network theorems', order: 0 },
        { id: 'C1', kind: 'concept', parentId: 'T1', name: 'Thevenin and Norton', order: 0 }, { id: 'C2', kind: 'concept', parentId: 'T1', name: 'Superposition', order: 1, prereq: ['C1'] }],
      mem: { C1: { S: 4, D: 5, last: t(20), due: t(24, 4), reps: 1, lapses: 0, ok: 1, fail: 0, state: 'review' } },
      active: null, plan: { date: '2026-09-27', avail: 120, base: 0, blocks: [{ key: 'review0', kind: 'review', min: 20, title: 'Review', cids: ['C1'], mids: [] }], progress: { review0: 5 } },
      createdAt: t(1), updatedAt: t(27) },
    'ses-2026-09': { sessions: [{ id: 'ss1', subjectId: 'S1', conceptIds: ['C1'], startedAt: t(20), endedAt: t(20, 11), focusSec: 3600, elapsedSec: 3600, pausedSec: 0, breakSec: 0, idleExcludedSec: 0, mode: 'reading', timerStyle: 'stopwatch', source: 'timer', status: 'stopped', updatedAt: t(20, 11) },
      { id: 'gone1', gone: true, updatedAt: t(21) }], updatedAt: t(21) },
    'rev-2026-09': { reviews: [{ id: 'r1', cid: 'C1', at: t(20, 12), g: 3, ivl: 4, S: 4 }], practice: [{ id: 'p1', cid: 'C1', at: t(20, 13), n: 5, c: 4, lv: 'standard' }], updatedAt: t(20) },
    'mis-2026-09': { items: [{ id: 'm1', cid: 'C2', at: t(22), q: 'Find Vth', type: 'sign', stage: 1, next: t(25, 4), retries: [], updatedAt: t(22) }], updatedAt: t(22) },
    'tb-2026-09': { items: [{ id: 'tb1', cid: 'C1', at: t(23), text: 'Explained', score: 70 }], updatedAt: t(23) },
    'pr-S1': { byConcept: { C1: [{ id: 'q1', kind: 'formula', q: 'Thevenin voltage?', a: 'Open-circuit voltage' }] }, updatedAt: t(19) },
    'notes-custom': { anything: 1 }
  };
}

describe('preparation file format', () => {
  it('migrates a v1 core in place, idempotently, keeping every field', () => {
    const c = v1Docs().core; const r = W.migrateCore(c);
    expect(r.core.v).toBe(2); expect(r.core.wsid).toMatch(/^ws/);
    expect(r.core.availability.weekday.minutes).toBe(180);
    expect(r.core.prep.setupDone).toBe(true);                          // existing users are not sent to the wizard
    expect(r.core.qmem).toEqual({}); expect(r.core.lectures).toEqual([]);
    expect(r.core.nodes.length).toBe(4); expect(r.core.mem.C1.reps).toBe(1); expect(r.core.plan.blocks.length).toBe(1);
    const again = W.migrateCore(JSON.parse(JSON.stringify(r.core)));
    expect(again.changed).toBe(false);
  });
  it('turns the internal documents into one file and back without losing anything', () => {
    const docs = v1Docs(); W.migrateCore(docs.core);
    const ws = W.docsToWorkspace(docs, { now: t(27, 12) });
    expect(ws.schemaVersion).toBe(2); expect(ws.app.format).toBe('prep-workspace');
    expect(ws.exam.name).toBe('GATE EE'); expect(ws.subjects.map(s => s.name)).toEqual(['Electric Circuits']);
    expect(ws.sessions.map(s => s.id)).toEqual(['ss1']);
    expect(ws.deleted).toEqual([{ doc: 'ses-2026-09', field: 'sessions', id: 'gone1', at: t(21) }]);
    expect(ws.practiceAttempts.length).toBe(1); expect(ws.recallPrompts.C1.length).toBe(1);
    expect(ws.extra['notes-custom']).toEqual({ anything: 1 });
    const text = W.serializeWorkspace(ws);
    const back = W.workspaceToDocs(W.parseWorkspaceText(text).ws);
    expect(Object.keys(back).sort()).toEqual(Object.keys(docs).sort());
    expect(back.core.plan.progress).toEqual({ review0: 5 });
    expect(back['ses-2026-09'].sessions.find(s => s.id === 'gone1').gone).toBe(true);
    expect(back['pr-S1'].byConcept.C1[0].a).toBe('Open-circuit voltage');
    expect(back.core.mem).toEqual(docs.core.mem);
    // merging the round-tripped copy with the original (as when a file is reconnected) duplicates nothing
    expect(mergeDoc('ses-2026-09', docs['ses-2026-09'], back['ses-2026-09']).sessions.length).toBe(2);
    expect(mergeDoc('rev-2026-09', docs['rev-2026-09'], back['rev-2026-09']).practice.length).toBe(1);
    expect(mergeDoc('core', docs.core, back.core).nodes.length).toBe(4);
  });
  it('opens a v1 "Export full backup" file and a bare core.json', () => {
    const backup = JSON.stringify({ app: 'logbook', v: 1, exportedAt: '2026-09-27', docs: v1Docs() });
    const r = W.parseWorkspaceText(backup);
    expect(r.source).toBe('v1-backup'); expect(r.ws.sessions.length).toBe(1); expect(r.ws.mistakes[0].q).toBe('Find Vth');
    const core = W.parseWorkspaceText(JSON.stringify(v1Docs().core));
    expect(core.source).toBe('v1-core'); expect(core.ws.nodes.length).toBe(4);
  });
  it('assembles old per-file data (as stored in the GitHub data repository)', () => {
    const files = Object.entries(v1Docs()).map(([k, v]) => ({ name: 'data/users/me/' + k + '.json', text: JSON.stringify(v) })).concat([{ name: 'README.md', text: '#' }]);
    const { docs, skipped } = W.docsFromFiles(files);
    expect(Object.keys(docs).length).toBe(7); expect(skipped).toEqual(['README.md']);
    expect(W.readWorkspace(docs).source).toBe('v1-docs');
  });
  it('rejects damaged, foreign and newer files with clear messages and no changes', () => {
    expect(() => W.parseWorkspaceText('{"schemaVersion": 2, "exams": [')).toThrow(/not valid JSON/);
    expect(() => W.parseWorkspaceText('')).toThrow(/empty/);
    expect(() => W.parseWorkspaceText('{"hello": "world"}')).toThrow(/not a preparation file/);
    try { W.parseWorkspaceText(JSON.stringify({ schemaVersion: 9, workspaceId: 'x', app: { format: 'prep-workspace' } })); throw new Error('no'); }
    catch (e) { expect(e.code).toBe('unsupported-version'); expect(e.message).toMatch(/newer version/); }
  });
  it('keeps the newest copy of duplicate ids and sets bad items aside instead of deleting them', () => {
    const docs = v1Docs(); W.migrateCore(docs.core);
    const ws = W.docsToWorkspace(docs);
    ws.sessions.push({ ...ws.sessions[0], focusSec: 7200, updatedAt: t(26) });
    ws.sessions.push({ id: 'bad', startedAt: 'yesterday', endedAt: 0, focusSec: 5 });
    ws.exams[0].date = '2027-02-30';
    ws.reviews = 'oops';
    const r = W.normalizeWorkspace(JSON.parse(JSON.stringify(ws)));
    expect(r.ws.sessions.length).toBe(1); expect(r.ws.sessions[0].focusSec).toBe(7200);
    expect(r.ws.exams[0].date).toBeUndefined();
    expect(r.ws.reviews).toEqual([]);
    const reasons = r.ws.quarantine.map(q => q.reason);
    expect(reasons).toEqual(expect.arrayContaining(['duplicate id, older copy', 'session with impossible times', 'expected a list', 'invalid date']));
    expect(r.warnings.join(' ')).toMatch(/duplicate id/);
    expect(r.warnings.join(' ')).toMatch(/invalid date/);
  });
  it('writes lecture and question data into the right documents', () => {
    const docs = { core: W.newCore({ activeExamId: null }) };
    docs.core.lectures = [{ id: 'l1', subjectId: 'S', order: 0, name: '', conceptIds: [] }, { id: 'l2', gone: true, subjectId: 'S', order: 1, name: '', conceptIds: [], updatedAt: 5 }];
    docs.core.qmem = { q1: { due: t(28), reps: 1, lapses: 0, ok: 1, fail: 0, state: 'review' } };
    docs['qs-2026-09'] = { items: [{ id: 'q1', text: 'Solve', createdAt: t(26) }], updatedAt: t(26) };
    docs['rev-2026-09'] = { reviews: [], practice: [], qattempts: [{ id: 'a1', qid: 'q1', at: t(26), result: 'correct', grade: 3 }], updatedAt: t(26) };
    const ws = W.docsToWorkspace(docs);
    expect(ws.lectures.map(l => l.id)).toEqual(['l1']); expect(ws.deleted[0]).toMatchObject({ doc: 'core.lectures', id: 'l2' });
    expect(ws.questionMemory.q1.reps).toBe(1); expect(ws.practiceQuestions.length).toBe(1); expect(ws.questionAttempts.length).toBe(1);
    const back = W.workspaceToDocs(ws);
    expect(back['qs-2026-09'].items[0].id).toBe('q1'); expect(back['rev-2026-09'].qattempts[0].id).toBe('a1');
    expect(back.core.lectures.find(l => l.id === 'l2').gone).toBe(true);
    expect(W.fingerprint('abc')).toBe(W.fingerprint('abc')); expect(W.fingerprint('abc')).not.toBe(W.fingerprint('abd'));
  });
});
