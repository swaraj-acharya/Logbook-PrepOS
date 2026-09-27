// @ts-nocheck
import { describe, it, expect } from 'vitest';
import * as R from '../lib/roadmap';
import { defaultAvailability, defaultPrep } from '../lib/workspace';
import { DEFAULT_MIX } from '../lib/engine.js';

const av = (o = {}) => Object.assign(defaultAvailability(180), { weekend: { minutes: 360, windows: [] } }, o);

describe('capacity', () => {
  it('adds up weekdays, weekends, rest days, unavailable dates and what was already studied today', () => {
    // 2026-09-28 is a Monday; one week to the next Monday
    const a = av({ restDays: [3], unavailable: ['2026-10-01'] });
    const c = R.capacity('2026-09-28', '2026-10-05', a, { todayKey: '2026-09-28', studiedTodayMin: 60 });
    // Mon 180-60, Tue 180, Wed rest, Thu unavailable, Fri 180, Sat 360, Sun 360
    expect(c.total).toBe(120 + 180 + 180 + 360 + 360);
    expect(c.studyDays).toBe(5); expect(c.weekendStudyDays).toBe(2); expect(c.restDays).toBe(2);
    const x = R.capacity('2026-09-28', '2026-10-05', a, { extraPerDay: 30 });
    expect(x.total - R.capacity('2026-09-28', '2026-10-05', a).total).toBe(30 * 5);   // extra only on study days
    expect(R.minutesOn('2026-10-02', { ...a, overrides: { '2026-10-02': 45 } })).toBe(45);
  });
});

describe('workload and feasibility', () => {
  const prep = defaultPrep();
  const subj = (o) => Object.assign({ id: 's', name: 'S', imp: 2, diff: 2, studiedMin: 0, concepts: [], lectures: [], questions: [], openMistakes: [] }, o);
  it('estimates from structure, from your own estimate, or from a labelled default', () => {
    const concepts = Array.from({ length: 10 }, () => ({ state: 0, viaLecture: false, imp: 2, acc: null, accN: 0, S: null }));
    const lectures = [{ min: 60, watched: false, studied: false, done: false }, { min: 60, watched: true, studied: false, done: false }, { min: 60, watched: true, studied: true, done: true }];
    const w = R.estimateWork([subj({ id: 'a', concepts, lectures }), subj({ id: 'b', estHours: 20, studiedMin: 300 }), subj({ id: 'c' })], { daysLeft: 120, prep, minPerReview: 1.5 });
    const [a, b, c] = w.subjects;
    expect(a.source).toBe('structure');
    expect(a.learnMin).toBe(Math.round((60 + 36 + 5) + (36 + 5) + 10 * 30));
    expect(a.practiceMin).toBe(200); expect(a.revisionMin).toBeGreaterThan(0);
    expect(b).toMatchObject({ source: 'estimate', learnMin: 900 });
    expect(c).toMatchObject({ source: 'default', learnMin: 40 * 60 });
    expect(w.assumptions.join(' ')).toMatch(/40 hours/);
    expect(w.totalMin).toBe(a.totalMin + b.totalMin + c.totalMin);
  });
  it('gives strong concepts less practice and weak-application concepts more', () => {
    const mk = (acc, accN) => subj({ concepts: [{ state: 3, viaLecture: false, imp: 2, acc, accN, S: 5 }] });
    const pm = x => R.estimateWork([x], { daysLeft: 60, prep, minPerReview: 1.5 }).practiceMin;
    expect(pm(mk(0.95, 20))).toBeLessThan(pm(mk(null, 0)));
    expect(pm(mk(0.4, 20))).toBeGreaterThan(pm(mk(null, 0)));
  });
  it('says a plan fits when it does', () => {
    const work = { subjects: [], totalMin: 180 * 60, practiceMin: 0 };
    const cap = R.capacity('2026-09-28', '2026-12-07', av());
    const f = R.assessFeasibility({ work, cap, av: av(), daysLeft: 70, subjects: [] });
    expect(f.status).toBe('ok'); expect(f.gapMin).toBe(0); expect(f.bufferMin).toBe(cap.total - 180 * 60);
  });
  it('never pretends an impossible plan fits: shows the gap and concrete options', () => {
    const a = av({ weekend: { minutes: 180, windows: [] }, restDays: [0] });
    const cap = R.capacity('2026-09-28', '2026-11-02', a);      // 5 weeks, 30 study days, 5 Sundays off
    const work = { subjects: [{ id: 'x', name: 'Quant', learnMin: 4000, practiceMin: 2000, optional: false }, { id: 'y', name: 'GK', learnMin: 1500, practiceMin: 500, optional: false }], totalMin: cap.total + 3000, practiceMin: 2500 };
    const f = R.assessFeasibility({ work, cap, av: a, daysLeft: 35, subjects: [{ id: 'x', name: 'Quant', imp: 3 }, { id: 'y', name: 'GK', imp: 1 }] });
    expect(f.status).toBe('short'); expect(f.gapMin).toBe(3000);
    expect(f.coverage).toBeCloseTo(cap.total / (cap.total + 3000));
    const daily = f.options.find(o => o.key === 'extra-daily');
    expect(daily.value).toBe(100);                                // ceil(3000 / 30 study days) = 100
    expect(R.capacity('2026-09-28', '2026-11-02', a, { extraPerDay: daily.value }).total).toBeGreaterThanOrEqual(work.totalMin);
    expect(f.options.map(o => o.key)).toEqual(expect.arrayContaining(['more-days', 'drop-optional', 'reduce-practice', 'prioritize', 'accept']));
    expect(f.options.some(o => o.key === 'extra-weekend')).toBe(false);   // 10 extra hours per Saturday is not a realistic offer
    const small = R.assessFeasibility({ work: { ...work, totalMin: cap.total + 600 }, cap, av: a, daysLeft: 35, subjects: [] });
    expect(small.options.find(o => o.key === 'extra-weekend')).toMatchObject({ value: 120, closesGap: true });
    expect(f.options.find(o => o.key === 'more-days').gainMin).toBe(5 * 180);
    expect(f.atRisk[0].name).toBe('GK');                          // low importance is what falls off first
    const eff = R.effortComparison(f);
    expect(eff.extra.perDay - eff.normal.perDay).toBe(100);
  });
});

describe('phases', () => {
  it('adapts to the time left', () => {
    const long = R.buildPhases('2026-09-27', '2027-05-25');     // 240 days
    expect(long.map(p => p.key)).toEqual(['foundation', 'coverage', 'practice', 'revision', 'final']);
    expect(long[0].start).toBe('2026-09-27'); expect(long[4].end).toBe('2027-05-24');
    const mid = R.buildPhases('2026-09-27', '2026-11-11');      // 45 days
    expect(mid.map(p => p.key)).toEqual(['coverage', 'practice', 'revision', 'final']);
    expect(mid[0].name).toBe('Learning and coverage');
    const week = R.buildPhases('2026-09-27', '2026-10-04');
    expect(week.map(p => p.key)).toEqual(['final']);
    expect(R.phaseOn(long, '2026-10-01').key).toBe('foundation');
    expect(R.buildPhases('2026-09-27', '2026-09-27')).toEqual([]);
    // contiguous, no gaps or overlaps
    for (let i = 1; i < long.length; i++) expect(R.phaseOn(long, long[i].start).key).toBe(long[i].key);
  });
  it('raises new learning when the syllabus needs it and lowers it when it is done', () => {
    const base = DEFAULT_MIX.early;
    const more = R.adaptMix(base, R.learnShare('foundation', 0.6, base));
    expect(more.new).toBeCloseTo(0.6);
    expect(Object.values(more).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(R.adaptMix(base, R.learnShare('foundation', 0, base)).new).toBe(0);
    expect(R.learnShare('final', 0.9, DEFAULT_MIX.final)).toBeLessThanOrEqual(0.1);
  });
});

describe('subject order and timeline', () => {
  it('puts prerequisites first, then priority', () => {
    const s = (id, o, extra = {}) => ({ id, name: id, order: o, imp: 2, priority: 2, ...extra });
    expect(R.subjectOrder([s('control', 0, { prereqSubjects: ['maths'], priority: 3 }), s('maths', 1), s('apt', 2, { priority: 3 })])).toEqual(['apt', 'maths', 'control']);
    expect(R.subjectOrder([s('a', 0, { prereqSubjects: ['b'] }), s('b', 1, { prereqSubjects: ['a'] })]).length).toBe(2);   // cycles do not hang
  });
  it('runs subjects in parallel groups and dates the finish', () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ k: '2026-10-' + String(i + 1).padStart(2, '0'), learn: 120 }));
    const t = R.subjectTimeline({ order: ['a', 'b', 'c'], learnMin: { a: 600, b: 600, c: 300 }, days, parallel: 2 });
    expect(t.rows.a.start).toBe('2026-10-01'); expect(t.rows.c.start).toBe('2026-10-11');
    expect(t.rows.a.end).toBe('2026-10-10'); expect(t.end).toBe('2026-10-13');
    const blocked = R.subjectTimeline({ order: ['a', 'b'], learnMin: { a: 600, b: 600 }, prereq: { b: ['a'] }, days, parallel: 2 });
    expect(blocked.rows.b.start > blocked.rows.a.start).toBe(true);
    const short = R.subjectTimeline({ order: ['a'], learnMin: { a: 100000 }, days, parallel: 1 });
    expect(short.end).toBeNull(); expect(short.rows.a.finished).toBe(false);
  });
});

describe('forecast', () => {
  const phases = R.buildPhases('2026-09-27', '2027-02-10');
  const days = R.capacity('2026-09-27', '2027-02-10', av()).perDay;
  it('reports on track when the syllabus fits before coverage ends', () => {
    const f = R.forecastCompletion({ today: '2026-09-27', learnRemainingMin: 60 * 60, days, phases, base: DEFAULT_MIX.early });
    expect(['on-track', 'ahead']).toContain(f.status); expect(f.completion <= f.target).toBe(true);
  });
  it('reports how far behind and the extra minutes a day needed', () => {
    const f = R.forecastCompletion({ today: '2026-09-27', learnRemainingMin: 400 * 60, days, phases, base: DEFAULT_MIX.early });
    expect(f.status).toBe('behind'); expect(f.extraMinPerDay).toBeGreaterThan(0); expect(f.extraMinPerDay % 5).toBe(0);
    expect(R.forecastCompletion({ today: '2026-09-27', learnRemainingMin: 0, days, phases }).status).toBe('done');
    expect(R.forecastCompletion({ today: '2026-09-27', learnRemainingMin: 600, days, phases, recentLearnMinPerDay: 60 }).recentCompletion).toBe('2026-10-07');
  });
});

describe('weekly review', () => {
  it('summarises the week and sets next week from the evidence', () => {
    const w = R.buildWeeklyReview({ from: '2026-09-21', to: '2026-09-27', plannedMin: 1260, studiedMin: 700, tasksDone: 10, tasksSkipped: 8, tasksPlanned: 20, lecturesDone: 4,
      questions: { attempted: 30, correct: 15 }, reviews: { done: 40, ok: 34 }, mistakesResolved: 2,
      subjects: [{ id: 'a', name: 'Quant', min: 500, targetShare: 0.4, accuracy: 0.8, evidence: 20 }, { id: 'b', name: 'VARC', min: 100, targetShare: 0.35, accuracy: 0.45, evidence: 12 }, { id: 'c', name: 'DILR', min: 100, targetShare: 0.25, accuracy: null, evidence: 0 }],
      backlog: { overdueReviews: 25, overdueQuestions: 3, lecturesBehind: 2, mistakesDue: 1 }, nextWeek: { availableMin: 1260, studyDays: 7, lectureTarget: 5, reviewsDue: 60 } });
    expect(w.strongest).toBe('Quant'); expect(w.weakest).toBe('VARC'); expect(w.accuracy).toBe(0.5);
    expect(w.focus.subjects[0]).toBe('VARC'); expect(w.focus.minutesPerDay).toBe(180); expect(w.focus.questions).toBe(33);
    expect(w.focus.notes.length).toBeGreaterThanOrEqual(4);
  });
});
