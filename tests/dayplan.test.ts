// @ts-nocheck
import { describe, it, expect } from 'vitest';
import * as P from '../lib/dayplan';
import { DEFAULT_MIX, DEFAULT_WEIGHTS, dayStart, addDays, HOUR } from '../lib/engine.js';
import { defaultPrep, defaultAvailability } from '../lib/workspace';
import { clockToMin } from '../lib/dates';

const sh = 4, today = '2026-09-28';
const now = new Date(2026, 8, 28, 6).getTime();
const sum = a => a.reduce((x, y) => x + y, 0);
function snap(o = {}) {
  const subjects = (o.subjects || ['Maths', 'Physics', 'Chemistry']).map((name, i) => ({ id: 'S' + i, name, order: i, imp: 2, priority: 2, share: 1, prereqSubjects: [], learnedFrac: 0, learnLeftMin: 1000 }));
  const concepts = [];
  subjects.forEach((s, si) => { for (let c = 0; c < (o.perSubject || 8); c++) concepts.push({ id: s.id + 'c' + c, sid: s.id, order: si * 100 + c, name: s.name + ' ' + c, prereq: [], imp: 2, state: 0, mem: null, practice: [], formula: false, viaLecture: false }); });
  return { now, today, sh, subjects, concepts, lectures: o.lectures || [], mistakes: o.mistakes || [], questions: o.questions || [], exposure: o.exposure || {},
    lastStudied: o.lastStudied || {}, lastStudyGapDays: o.gap || 0, weights: DEFAULT_WEIGHTS, minPerReview: 1.5, memOpts: { retention: 0.9, sh, maxIvl: 3650 } };
}
const opts = (o = {}) => ({ minutes: 180, windows: [], phase: null, mixKey: 'early', mix: DEFAULT_MIX.early, daysLeft: 200, subjectsPerDay: 2, ...o, prep: Object.assign(defaultPrep(), o.prep || {}) });
const lecturesFor = (sid, n, min = 50) => Array.from({ length: n }, (_, i) => ({ id: sid + 'L' + (i + 1), sid, order: i, label: 'L' + String(i + 1).padStart(2, '0'), min, cids: [sid + 'c' + i], watched: false, studied: false, recalled: false, done: false }));

describe('day plan', () => {
  it('plans subjects that have no topics yet as whole-subject study, not empty practice blocks', () => {
    const sn = snap({ subjects: ['Contracts', 'Torts'] }); sn.concepts = [];
    const d = P.buildDay(sn, today, opts({ minutes: 155, subjectsPerDay: 0 }));
    const real = d.tasks.filter(t => t.kind !== 'break');
    expect(real.length).toBeGreaterThan(0);
    expect(real.every(t => t.kind === 'new' && t.subjectId && /^Study (Contracts|Torts)/.test(t.title))).toBe(true);
    expect(new Set(real.map(t => t.subjectId)).size).toBe(2);
    expect(sum(d.tasks.map(t => t.min))).toBeLessThanOrEqual(155);
    expect(sum(real.map(t => t.min))).toBeGreaterThanOrEqual(145);
    expect(real.every(t => t.min <= 90)).toBe(true);                     // long blocks are split
    expect(real[0].why[0]).toMatch(/no topics or concepts yet/);
    // in the practice phases the same time becomes practice for that subject
    const late = P.buildDay(sn, today, opts({ minutes: 60, subjectsPerDay: 0, phase: { key: 'final', name: 'Final preparation', start: today, end: today, desc: '', mixKey: 'final' }, mixKey: 'final', mix: DEFAULT_MIX.final }));
    expect(late.tasks.filter(t => t.kind !== 'break').every(t => t.kind === 'practice' && /^Practise/.test(t.title))).toBe(true);
    // projections count that time against the subject
    const days = P.projectDays(sn, today, 3, () => opts({ minutes: 120, subjectsPerDay: 1 }));
    expect(new Set(days.map(x => x.tasks.find(t => t.kind === 'new').subjectId)).size).toBe(2);
  });
  it('mixes whole-subject study with concept-level work when only some subjects have structure', () => {
    const sn = snap({ perSubject: 6, subjects: ['Algebra', 'Essay writing'] });
    sn.concepts = sn.concepts.filter(c => c.sid === 'S0');
    const d = P.buildDay(sn, today, opts({ minutes: 180, subjectsPerDay: 0 }));
    expect(d.tasks.some(t => t.kind === 'new' && t.cids.length && t.cids[0].startsWith('S0'))).toBe(true);
    expect(d.tasks.some(t => t.subjectId === 'S1' && t.title.startsWith('Study Essay writing'))).toBe(true);
    expect(sum(d.tasks.map(t => t.min))).toBe(180);
  });
  it('fills the day exactly and keeps new learning to the chosen subjects', () => {
    const d = P.buildDay(snap(), today, opts());
    expect(sum(d.tasks.map(t => t.min))).toBe(180);
    expect(d.subjects.length).toBe(2);
    const chosen = new Set(d.subjects.map(s => s.id));
    const newTasks = d.tasks.filter(t => t.kind === 'new');
    expect(newTasks.length).toBeGreaterThan(0);
    expect(newTasks.every(t => t.cids.every(c => chosen.has(c.slice(0, 2))))).toBe(true);
    expect(d.tasks.every(t => t.why && t.why.length)).toBe(true);        // every task explains itself
  });
  it('rotates subjects across the week instead of one subject a day', () => {
    const days = P.projectDays(snap(), today, 6, () => opts({ subjectsPerDay: 1 }));
    const picks = days.map(d => d.subjects[0].id);
    expect(new Set(picks).size).toBe(3);
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  });
  it('prefers the subject furthest below its target share and says why', () => {
    const exposure = { [addDays(today, -1)]: { S0: 300, S1: 20, S2: 280 } };
    const d = P.buildDay(snap({ exposure, lastStudied: { S0: addDays(today, -1), S1: addDays(today, -1), S2: addDays(today, -1) } }), today, opts({ subjectsPerDay: 1 }));
    expect(d.subjects[0].id).toBe('S1');
    expect(d.subjects[0].why.join(' ')).toMatch(/below its target share/);
    expect(d.subjects[0].why.join(' ')).toMatch(/200 days remaining/);
  });
  it('waits for prerequisite subjects', () => {
    const s = snap(); s.subjects[2].prereqSubjects = ['S0']; s.subjects[2].priority = 3;
    const pick = P.pickSubjects(s, today, 2, {});
    expect(pick.ids).not.toContain('S2');
    expect(pick.why.S2.join(' ')).toMatch(/waits for Maths/);
  });
  it('turns lectures into watch, self-study and recall, in lecture order', () => {
    const s = snap({ subjects: ['Programming'], lectures: lecturesFor('S0', 5) });
    s.concepts.forEach(c => { c.viaLecture = true; });
    const d = P.buildDay(s, today, opts({ prep: { mode: 'lectures' }, subjectsPerDay: 1, minutes: 180 }));
    const kinds = d.tasks.map(t => t.kind);
    expect(kinds.slice(0, 3)).toEqual(['lecture', 'selfstudy', 'review']);
    expect(d.tasks[0]).toMatchObject({ title: 'Watch L01', lectureId: 'S0L1', min: 50 });
    expect(d.tasks[1].min).toBe(30);                                       // 60% of 50, rounded to 5
    expect(sum(d.tasks.map(t => t.min))).toBe(180);
    const week = P.projectDays(s, today, 3, () => opts({ prep: { mode: 'lectures' }, subjectsPerDay: 1, minutes: 120 }));
    const watched = week.flatMap(w => w.tasks.filter(t => t.kind === 'lecture').map(t => t.lectureId));
    expect(watched).toEqual(['S0L1', 'S0L2', 'S0L3']);                    // continues the sequence day by day
  });
  it('consolidates a watched lecture before starting the next one', () => {
    const ls = lecturesFor('S0', 3); ls[0].watched = true; ls[0].watchedAt = now - 20 * HOUR;
    const d = P.buildDay(snap({ subjects: ['Physics'], lectures: ls }), today, opts({ prep: { mode: 'lectures' }, subjectsPerDay: 1 }));
    expect(d.tasks[0]).toMatchObject({ kind: 'selfstudy', lectureId: 'S0L1' });
    expect(d.tasks[0].why[0]).toMatch(/L01 was watched/);
    expect(d.tasks.find(t => t.kind === 'lecture').lectureId).toBe('S0L2');
  });
  it('mixes less new learning and more revision near the exam', () => {
    const s = snap(); s.concepts.slice(0, 12).forEach((c, i) => { c.state = 3; c.mem = { S: 5, D: 5, last: now - 6 * 86400000, due: now - 3600000, ivl: 5, reps: 2, lapses: 0, ok: 2, fail: 0, state: 'review' }; });
    const early = P.buildDay(s, today, opts({ mixKey: 'early', mix: DEFAULT_MIX.early, daysLeft: 200 }));
    const late = P.buildDay(s, today, opts({ mixKey: 'final', mix: DEFAULT_MIX.final, daysLeft: 20 }));
    const newMin = d => sum(d.tasks.filter(t => t.kind === 'new').map(t => t.min));
    expect(newMin(late)).toBeLessThan(newMin(early));
    expect(sum(late.tasks.filter(t => t.kind === 'review').map(t => t.min))).toBeGreaterThan(0);
  });
  it('adds question review when saved questions are due, recently wrong ones first', () => {
    const q = (id, dueH, wrong) => ({ id, sid: 'S0', cid: 'S0c0', recentWrong: wrong, mem: { due: now + dueH * HOUR, S: 3, reps: 1 } });
    const d = P.buildDay(snap({ questions: [q('a', -30, false), q('b', 2, true), q('c', 48, false)] }), today, opts());
    const qr = d.tasks.find(t => t.kind === 'qreview');
    expect(qr.qids).toEqual(['b', 'a']);
    expect(qr.why.join(' ')).toMatch(/2 saved questions due/);
    expect(sum(d.tasks.map(t => t.min))).toBe(180);
  });
  it('places tasks inside study windows with gaps, and keeps locked tasks where you put them', () => {
    const windows = [{ start: '07:00', end: '09:00' }, { start: '18:00', end: '19:30' }];
    const d = P.buildDay(snap(), today, opts({ windows, minutes: 180 }));
    const timed = d.tasks.filter(t => t.start);
    for (const t of timed) {
      const a = clockToMin(t.start), b = clockToMin(t.end);
      expect(b - a).toBe(t.min);
      expect(windows.some(w => a >= clockToMin(w.start) && b <= clockToMin(w.end))).toBe(true);
    }
    for (let i = 1; i < timed.length; i++) expect(clockToMin(timed[i].start)).toBeGreaterThanOrEqual(clockToMin(timed[i - 1].end));
    const locked = { key: 'mine', kind: 'practice', min: 30, title: 'My mock', cids: [], mids: [], locked: true, start: '18:00', end: '18:30', status: 'todo' };
    const d2 = P.buildDay(snap(), today, opts({ windows, minutes: 180, keep: [locked] }));
    expect(d2.tasks.find(t => t.key === 'mine')).toMatchObject({ start: '18:00', end: '18:30' });
    expect(d2.tasks.filter(t => t.key !== 'mine' && t.start).every(t => clockToMin(t.end) <= clockToMin('18:00') || clockToMin(t.start) >= clockToMin('18:35'))).toBe(true);
  });
  it('skips windows that already passed today', () => {
    const d = P.buildDay(snap(), today, opts({ windows: [{ start: '06:00', end: '08:00' }, { start: '18:00', end: '21:00' }], fromMin: 10 * 60, minutes: 120 }));
    expect(d.tasks.filter(t => t.start).every(t => clockToMin(t.start) >= 18 * 60)).toBe(true);
  });
  it('never replaces locked, edited, done or skipped tasks when regenerating', () => {
    const first = P.buildDay(snap(), today, opts());
    const edited = first.tasks.map((t, i) => i === 0 ? { ...t, status: 'done' } : i === 1 ? { ...t, manual: true, min: 25 } : i === 2 ? { ...t, status: 'skipped' } : t);
    const keep = P.keepOnRegenerate(edited, () => false);
    expect(keep.map(t => t.key)).toEqual(edited.slice(0, 3).map(t => t.key));
    const again = P.buildDay(snap(), today, opts({ keep, minutes: 180 }));
    for (const k of keep) expect(again.tasks.find(t => t.key === k.key)).toMatchObject({ status: k.status, min: k.min });
    expect(sum(again.tasks.filter(t => t.status === 'todo').map(t => t.min))).toBe(180);
  });
});

describe('missed days and recovery', () => {
  const av = defaultAvailability(120);
  it('finds missed planned days and the current streak, ignoring rest days', () => {
    const a = { ...av, restDays: [6] };                // Saturday off (26 Sep 2026 is a Saturday)
    const studied = { '2026-09-24': 110, '2026-09-25': 0, '2026-09-27': 5 };
    const m = P.detectMissed({ today, history: {}, studiedMin: studied, av: a, lookback: 5 });
    expect(m.days).toEqual(['2026-09-27', '2026-09-25', '2026-09-23']);
    expect(m.streak).toBe(2);                          // Sun and Fri missed, the rest day in between does not break it; Thu was studied
    expect(P.detectMissed({ today, history: {}, studiedMin: studied, av: a, since: '2026-09-27' }).days).toEqual(['2026-09-27']);
  });
  it('spreads the backlog over the coming days instead of stacking it on today', () => {
    const next = Array.from({ length: 14 }, (_, i) => ({ k: addDays(today, i), min: 120 }));
    const r = P.recoveryPlan({ missed: { days: ['a', 'b'], streak: 2, plannedMin: 240 }, overdueReviews: 60, minPerReview: 1.5, missedLectureMin: 100, mistakesDue: 4, questionsDue: 6, minPerQuestion: 5, nextDays: next });
    expect(r.backlogMin).toBe(90 + 20 + 30);
    expect(r.perDayCatchUp).toBeLessThanOrEqual(120 * 0.4 + 5);
    expect(r.daysToClear).toBe(3); expect(r.realistic).toBe(true);
    expect(r.lines.join(' ')).toMatch(/continue in order/);
  });
  it('caps review load after a long gap (engine behaviour carried through)', () => {
    const s = snap({ gap: 6 }); s.concepts.forEach(c => { c.state = 3; c.mem = { S: 3, D: 5, last: now - 9 * 86400000, due: now - 5 * 86400000, ivl: 3, reps: 2, lapses: 0, ok: 2, fail: 0, state: 'review' }; });
    const d = P.buildDay(s, today, opts({ minutes: 60, recoveryDays: 3 }));
    expect(sum(d.tasks.filter(t => t.kind === 'review').map(t => t.min))).toBeLessThanOrEqual(35);
    expect(d.notes[0]).toMatch(/You missed 3 planned study days/);
  });
});

describe('practice feeds planning', () => {
  it('moves concepts with weak application to the front of practice and explains it', () => {
    const s = snap({ subjects: ['Control'] });
    s.concepts.forEach(c => { c.state = 3; });
    s.concepts[5].practice = Array.from({ length: 20 }, (_, i) => ({ n: 1, c: i < 8 ? 1 : 0, at: i }));
    s.concepts[2].practice = Array.from({ length: 20 }, (_, i) => ({ n: 1, c: i < 19 ? 1 : 0, at: i }));
    const C = P.candidates(s, today);
    expect(C.practiceCands[0].cid).toBe('S0c5');
    expect(C.practiceCands.find(c => c.cid === 'S0c2').factor).toBeLessThan(1);
    const d = P.buildDay(s, today, opts({ subjectsPerDay: 1, mixKey: 'middle', mix: DEFAULT_MIX.middle }));
    const pr = d.tasks.find(t => t.kind === 'practice');
    expect(pr.cids[0]).toBe('S0c5');
    expect(pr.why.join(' ')).toMatch(/understood, but 40% on 20 questions/);
  });
});
