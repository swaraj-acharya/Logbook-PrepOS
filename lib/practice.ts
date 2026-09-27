/*
 * Question-level practice.
 *
 * Two memory layers stay separate on purpose:
 *   concept memory  (core.mem)   "Do I remember the idea?"       reviewed with recall prompts
 *   question memory (core.qmem)  "Can I still solve this one?"   reviewed by re-solving the saved question
 * Both use the same FSRS engine. Every question attempt also writes an aggregate practice record for the linked
 * concept, so estimated mastery, concept states and analytics keep working unchanged.
 */
import { Memory, dayKey, addDays, dayStart, DAY } from './engine.js';
import type { ID, MemoryRecord, Mistake, PracticeAttempt, PracticeQuestion, QuestionAttempt, QuestionDifficulty, QuestionResult } from './types';

type IdFn = (prefix: string) => string;
const defaultId: IdFn = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export type MemOpts = { retention: number; sh: number; maxIvl: number; fuzz?: boolean };

export const RESULT_SCORE: Record<QuestionResult, number> = { correct: 1, partial: 0.5, incorrect: 0 };
const LEVEL: Record<QuestionDifficulty, PracticeAttempt['lv']> = { easy: 'basic', medium: 'standard', hard: 'advanced' };

export function resultToGrade(result: QuestionResult, o: { timeSec?: number | null; confidence?: number | null } = {}): 1 | 2 | 3 | 4 {
  if (result === 'incorrect') return 1;
  if (result === 'partial') return 2;
  if ((o.confidence || 0) >= 4 && o.timeSec != null && o.timeSec <= 90) return 4;
  return 3;
}

export function createQuestion(f: Partial<PracticeQuestion>, opts: { now?: number; id?: IdFn } = {}): PracticeQuestion {
  const text = String(f.text || '').trim();
  if (!text) throw new Error('A question needs its text.');
  const now = opts.now ?? Date.now();
  const tags = Array.isArray(f.tags) ? f.tags.map(t => String(t).trim()).filter(Boolean) : [];
  return {
    id: f.id || (opts.id || defaultId)('qq'), text,
    subjectId: f.subjectId || null, topicId: f.topicId || null, subtopicId: f.subtopicId || null, conceptId: f.conceptId || null,
    source: f.source || '', ref: f.ref || '', difficulty: f.difficulty || 'medium', type: f.type || 'other',
    answer: f.answer || '', solution: f.solution || '', notes: f.notes || '', url: f.url || '', image: f.image || '',
    tags: [...new Set(tags)], createdAt: f.createdAt || now, updatedAt: now
  };
}

export type AttemptOutcome = { attempt: QuestionAttempt; mem: MemoryRecord; practice: PracticeAttempt | null;
  mistake: 'create' | 'reset' | 'none'; ivl: number };
/** Records one attempt: schedules the question's next review and produces the concept-level practice record. */
export function recordAttempt(i: { question: PracticeQuestion; mem: MemoryRecord | null; result: QuestionResult;
  timeSec?: number | null; confidence?: number | null; mode?: QuestionAttempt['mode']; sessionId?: ID | null;
  openMistake?: Mistake | null; now?: number; memOpts: MemOpts; id?: IdFn; answer?: string }): AttemptOutcome {
  const now = i.now ?? Date.now(), id = i.id || defaultId;
  const grade = resultToGrade(i.result, i);
  const res = Memory.apply(i.mem && i.mem.S ? i.mem : null, grade, now, i.memOpts);
  const attempt: QuestionAttempt = { id: id('qa'), qid: i.question.id, at: now, result: i.result, grade,
    timeSec: i.timeSec ?? null, confidence: i.confidence ?? null, mode: i.mode || 'practice', sessionId: i.sessionId || null, ivl: res.ivl,
    ...(i.answer ? { answer: i.answer } : {}) };
  const practice: PracticeAttempt | null = i.question.conceptId ? { id: id('p'), cid: i.question.conceptId, at: now, n: 1,
    c: RESULT_SCORE[i.result], lv: (i.question.tags || []).includes('unfamiliar') ? 'unfamiliar' : LEVEL[i.question.difficulty || 'medium'],
    qid: i.question.id, min: i.timeSec ? Math.round(i.timeSec / 6) / 10 : null, src: i.question.source || '' } : null;
  const mistake = i.result !== 'incorrect' ? 'none' : i.openMistake && !i.openMistake.resolved ? 'reset' : 'create';
  return { attempt, mem: res.m as MemoryRecord, practice, mistake, ivl: res.ivl };
}

/** A wrong question becomes a mistake that keeps the actual question: retry tomorrow, then 3, 7 and 21 days. */
export function mistakeFromQuestion(q: PracticeQuestion, f: Partial<Mistake>, opts: { now?: number; sh: number; id?: IdFn }): Mistake {
  const now = opts.now ?? Date.now();
  return { id: (opts.id || defaultId)('m'), at: now, q: q.text, qid: q.id, cid: q.conceptId || null, sid: q.subjectId || null,
    type: f.type || 'concept', why: f.why || '', fix: f.fix || q.solution || q.answer || '', remember: f.remember || '', src: [q.source, q.ref].filter(Boolean).join(' '),
    stage: 0, next: dayStart(addDays(dayKey(now, opts.sh), 1), opts.sh), attempts: [], resolved: false, updatedAt: now };
}
/** Getting a question wrong again sends its open mistake back to the first retry. */
export function resetMistake(m: Mistake, now: number, sh: number): Mistake {
  return { ...m, stage: 0, next: dayStart(addDays(dayKey(now, sh), 1), sh), attempts: (m.attempts || []).concat({ at: now, r: 'wrong', stage: m.stage || 0 }), updatedAt: now };
}

export type QuestionState = 'new' | 'learning' | 'review' | 'stable' | 'struggling';
export function questionState(mem: MemoryRecord | null | undefined, attempts: QuestionAttempt[]): QuestionState {
  if (!attempts.length || !mem || !mem.S) return 'new';
  const wrong = attempts.filter(a => a.result === 'incorrect').length;
  const last = attempts[attempts.length - 1];
  if (wrong >= 2 && wrong / attempts.length >= 0.4 && last.result !== 'correct') return 'struggling';
  if (mem.S >= 21 && last.result === 'correct') return 'stable';
  if (mem.reps >= 2 && last.result !== 'incorrect') return 'review';
  return 'learning';
}

export type QuestionStats = { attempted: number; correct: number; partial: number; incorrect: number; accuracy: number | null };
export function questionStats(attempts: QuestionAttempt[]): QuestionStats {
  const c = attempts.filter(a => a.result === 'correct').length, p = attempts.filter(a => a.result === 'partial').length;
  const n = attempts.length;
  return { attempted: n, correct: c, partial: p, incorrect: n - c - p, accuracy: n ? (c + 0.5 * p) / n : null };
}

export type ReviewBuckets = {
  dueToday: ID[]; overdue: ID[]; recentlyWrong: ID[]; frequentlyFailed: ID[]; lowConfidence: ID[];
  notRecent: ID[]; strongConceptWeakQuestions: { cid: ID; accuracy: number; n: number; qids: ID[] }[];
};
/** The groups shown on the question review dashboard. */
export function reviewBuckets(i: { questions: PracticeQuestion[]; qmem: Record<ID, MemoryRecord>; attempts: QuestionAttempt[];
  now: number; sh: number; conceptStrength?: (cid: ID) => number | null; staleDays?: number }): ReviewBuckets {
  const today = dayKey(i.now, i.sh), end = dayStart(addDays(today, 1), i.sh), start = dayStart(today, i.sh);
  const byQ: Record<ID, QuestionAttempt[]> = {};
  for (const a of i.attempts.slice().sort((x, y) => x.at - y.at)) (byQ[a.qid] || (byQ[a.qid] = [])).push(a);
  const live = i.questions.filter(q => q && !q.gone);
  const out: ReviewBuckets = { dueToday: [], overdue: [], recentlyWrong: [], frequentlyFailed: [], lowConfidence: [], notRecent: [], strongConceptWeakQuestions: [] };
  const stale = (i.staleDays || 14) * DAY;
  const byConcept: Record<ID, ID[]> = {};
  for (const q of live) {
    const m = i.qmem[q.id], at = byQ[q.id] || [], last = at[at.length - 1];
    if (m && m.due < end) { if (m.due < start) out.overdue.push(q.id); else out.dueToday.push(q.id); }
    if (at.some(a => a.result === 'incorrect' && i.now - a.at <= 7 * DAY)) out.recentlyWrong.push(q.id);
    const wrong = at.filter(a => a.result === 'incorrect').length;
    if (wrong >= 2 && wrong / at.length >= 0.4) out.frequentlyFailed.push(q.id);
    if (last && last.confidence != null && last.confidence <= 2) out.lowConfidence.push(q.id);
    if (last && i.now - last.at > stale) out.notRecent.push(q.id);
    if (q.conceptId && at.length) (byConcept[q.conceptId] || (byConcept[q.conceptId] = [])).push(q.id);
  }
  if (i.conceptStrength) {
    for (const cid in byConcept) {
      const strength = i.conceptStrength(cid); if (strength == null || strength < 0.7) continue;
      const qids = byConcept[cid], st = questionStats(qids.flatMap(q => byQ[q] || []));
      if (st.attempted >= 3 && st.accuracy != null && st.accuracy < 0.6) out.strongConceptWeakQuestions.push({ cid, accuracy: st.accuracy, n: st.attempted, qids });
    }
  }
  return out;
}

/** Due questions in review order: overdue and recently wrong first, then interleaved by subject. */
export function reviewOrder(qids: ID[], i: { questions: Record<ID, PracticeQuestion>; qmem: Record<ID, MemoryRecord>; recentlyWrong?: Set<ID> }): ID[] {
  const score = (id: ID) => { const m = i.qmem[id]; return (m ? -m.due / DAY : 0) + (i.recentlyWrong && i.recentlyWrong.has(id) ? 1e6 : 0); };
  const sorted = qids.slice().sort((a, b) => score(b) - score(a));
  const bySub: Record<string, ID[]> = {};
  for (const q of sorted) { const s = (i.questions[q] && i.questions[q].subjectId) || '_'; (bySub[s] || (bySub[s] = [])).push(q); }
  const out: ID[] = []; let more = true;
  while (more) { more = false; for (const k in bySub) if (bySub[k].length) { out.push(bySub[k].shift() as ID); more = true; } }
  return out;
}

export type PracticeSignal = { accuracy: number | null; n: number; signal: 'none' | 'building' | 'weak-application' | 'strong'; factor: number; note: string };
/**
 * What practice says about a concept, next to what recall says.
 *  understood (recall fine or state Retrieved+) but accuracy < 60% on 5+ questions  → weak application: practise more
 *  accuracy >= 90% on 10+ questions                                                   → strong: shift time elsewhere
 * `factor` scales how much practice the planner gives the concept.
 */
export function practiceSignal(i: { practice: { n: number; c: number; at: number }[]; recall: number | null; state: number }): PracticeSignal {
  const recent = i.practice.slice().sort((a, b) => a.at - b.at).slice(-20);
  const n = recent.reduce((a, p) => a + p.n, 0), c = recent.reduce((a, p) => a + p.c, 0);
  const accuracy = n ? c / n : null;
  if (!n) return { accuracy, n, signal: 'none', factor: 1, note: '' };
  const understood = (i.recall != null && i.recall >= 0.7) || i.state >= 3;
  if (n >= 5 && accuracy! < 0.6 && understood) return { accuracy, n, signal: 'weak-application', factor: 1.8,
    note: 'Concept understood but application is weak: ' + Math.round(accuracy! * 100) + '% on ' + fmtN(n) + ' questions.' };
  if (n >= 10 && accuracy! >= 0.9) return { accuracy, n, signal: 'strong', factor: 0.3,
    note: 'Practice is strong (' + Math.round(accuracy! * 100) + '% on ' + fmtN(n) + ' questions), so less practice time goes here.' };
  return { accuracy, n, signal: 'building', factor: accuracy! < 0.75 ? 1.2 : 1, note: '' };
}
const fmtN = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);
