// @ts-nocheck
import { describe, it, expect } from 'vitest';
import * as Q from '../lib/practice';
import * as E from '../lib/engine.js';

let n = 0; const id = p => p + (++n);
const sh = 4, memOpts = { retention: 0.9, sh, maxIvl: 3650 };
const t0 = new Date(2026, 8, 27, 10).getTime();

describe('practice questions', () => {
  it('creates a question linked to a concept and refuses empty text', () => {
    const q = Q.createQuestion({ text: '  Find the transfer function of the system  ', conceptId: 'c1', subjectId: 's1', difficulty: 'medium', tags: ['pyq', 'pyq', ' '] }, { id, now: t0 });
    expect(q.text).toBe('Find the transfer function of the system');
    expect(q.conceptId).toBe('c1'); expect(q.tags).toEqual(['pyq']);
    expect(() => Q.createQuestion({ text: '   ' })).toThrow();
  });
  it('schedules question memory with FSRS and writes a concept-level practice record', () => {
    const q = Q.createQuestion({ text: 'Q', conceptId: 'c1', difficulty: 'hard' }, { id, now: t0 });
    const ok = Q.recordAttempt({ question: q, mem: null, result: 'correct', timeSec: 300, confidence: 3, memOpts, now: t0, id });
    expect(ok.attempt).toMatchObject({ qid: q.id, result: 'correct', grade: 3 });
    expect(ok.mem.reps).toBe(1); expect(ok.ivl).toBeGreaterThanOrEqual(3);
    expect(ok.practice).toMatchObject({ cid: 'c1', n: 1, c: 1, lv: 'advanced', qid: q.id });
    expect(ok.mistake).toBe('none');
    const later = ok.mem.due + 3600000;
    const again = Q.recordAttempt({ question: q, mem: ok.mem, result: 'correct', memOpts, now: later, id });
    expect(again.ivl).toBeGreaterThan(ok.ivl);                       // spacing grows
    const wrong = Q.recordAttempt({ question: q, mem: again.mem, result: 'incorrect', memOpts, now: again.mem.due + 3600000, id });
    expect(wrong.mem.lapses).toBe(1); expect(wrong.ivl).toBeLessThan(again.ivl);
    expect(wrong.practice.c).toBe(0); expect(wrong.mistake).toBe('create');
    const partial = Q.recordAttempt({ question: q, mem: null, result: 'partial', memOpts, now: t0, id });
    expect(partial.attempt.grade).toBe(2); expect(partial.practice.c).toBe(0.5);
    const noConcept = Q.recordAttempt({ question: Q.createQuestion({ text: 'loose' }, { id }), mem: null, result: 'correct', memOpts, now: t0, id });
    expect(noConcept.practice).toBeNull();
  });
  it('turns a wrong question into a mistake that keeps the question, and resets it on repeat failure', () => {
    const q = Q.createQuestion({ text: 'Integrate x e^x', conceptId: 'c9', subjectId: 's2', solution: 'By parts', source: 'Book', ref: 'Q12' }, { id, now: t0 });
    const m = Q.mistakeFromQuestion(q, { type: 'calculation' }, { now: t0, sh, id });
    expect(m).toMatchObject({ q: 'Integrate x e^x', qid: q.id, cid: 'c9', sid: 's2', stage: 0, fix: 'By parts', src: 'Book Q12' });
    expect(m.next).toBe(E.dayStart(E.addDays(E.dayKey(t0, sh), 1), sh));
    const attempt = Q.recordAttempt({ question: q, mem: null, result: 'incorrect', memOpts, openMistake: { ...m, stage: 2 }, now: t0, id });
    expect(attempt.mistake).toBe('reset');
    expect(Q.resetMistake({ ...m, stage: 2 }, t0, sh).stage).toBe(0);
  });
  it('builds the review dashboard groups', () => {
    const day = 86400000, now = t0;
    const qs = ['a', 'b', 'c', 'd', 'e'].map(x => ({ id: x, text: x, conceptId: x === 'e' ? 'strong' : 'c', createdAt: 0 }));
    const qmem = { a: { due: now - 2 * day, reps: 1 }, b: { due: now, reps: 1 }, c: { due: now + 5 * day, reps: 1 } };
    const at = (qid, result, dAgo, confidence = 3) => ({ id: qid + dAgo + result, qid, at: now - dAgo * day, result, confidence });
    const attempts = [at('a', 'incorrect', 3), at('a', 'incorrect', 1), at('b', 'correct', 20, 1), at('c', 'correct', 1),
      at('e', 'incorrect', 2), at('e', 'incorrect', 3), at('e', 'correct', 4)];
    const b = Q.reviewBuckets({ questions: qs, qmem, attempts, now, sh, conceptStrength: cid => cid === 'strong' ? 0.85 : 0.4 });
    expect(b.overdue).toEqual(['a']); expect(b.dueToday).toEqual(['b']);
    expect(b.recentlyWrong).toEqual(['a', 'e']); expect(b.frequentlyFailed).toEqual(['a', 'e']);
    expect(b.lowConfidence).toEqual(['b']); expect(b.notRecent).toEqual(['b']);
    expect(b.strongConceptWeakQuestions).toEqual([{ cid: 'strong', accuracy: 1 / 3, n: 3, qids: ['e'] }]);
  });
  it('reads practice against recall: weak application gets more practice, strong gets less', () => {
    const recs = (k, c) => Array.from({ length: k }, (_, i) => ({ n: 1, c: i < c ? 1 : 0, at: i }));
    const weak = Q.practiceSignal({ practice: recs(20, 8), recall: 0.85, state: 4 });
    expect(weak.signal).toBe('weak-application'); expect(weak.factor).toBeGreaterThan(1);
    expect(weak.note).toMatch(/understood but application is weak: 40% on 20/);
    const strong = Q.practiceSignal({ practice: recs(20, 19), recall: 0.9, state: 5 });
    expect(strong.signal).toBe('strong'); expect(strong.factor).toBeLessThan(1);
    expect(Q.practiceSignal({ practice: [], recall: null, state: 0 }).signal).toBe('none');
    expect(Q.questionState({ S: 30, reps: 4 }, [{ result: 'correct' }])).toBe('stable');
    expect(Q.questionState({ S: 2, reps: 3 }, [{ result: 'incorrect' }, { result: 'incorrect' }, { result: 'partial' }])).toBe('struggling');
  });
  it('orders due questions: recently wrong first, then interleaved by subject', () => {
    const questions = { a: { subjectId: 'x' }, b: { subjectId: 'x' }, c: { subjectId: 'y' }, d: { subjectId: 'y' } };
    const qmem = { a: { due: 1 }, b: { due: 2 }, c: { due: 3 }, d: { due: 4 } };
    expect(Q.reviewOrder(['a', 'b', 'c', 'd'], { questions, qmem, recentlyWrong: new Set(['d']) })).toEqual(['d', 'a', 'c', 'b']);
  });
});
