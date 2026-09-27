/*
 * Roadmap: what has to be done, how much time there is, and whether the two fit.
 *
 * Everything here is deterministic and local. Estimates are labelled as estimates in the UI; the numbers below are
 * product assumptions (editable in Settings), not research findings.
 */
import { addDays, daysBetween, DEFAULT_MIX } from './engine.js';
import { weekdayOf } from './dates';
import type { DateKey, ID, Level3, PrepConfig, RoadmapPhase, RoadmapPhaseKey, StudyAvailability } from './types';

const r5 = (n: number) => Math.ceil(Math.max(0, n) / 5) * 5;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/* ------------------------------------------------------------------ capacity */

export function isWeekendDay(k: DateKey, av: StudyAvailability): boolean { return av.weekendDays.includes(weekdayOf(k)); }
/** Planned study minutes on one date. Extra effort is added only to days that already have study time. */
export function minutesOn(k: DateKey, av: StudyAvailability, extraPerDay = 0): number {
  if (av.unavailable.includes(k)) return 0;
  if (av.overrides && Object.prototype.hasOwnProperty.call(av.overrides, k)) return av.overrides[k];
  if (av.restDays.includes(weekdayOf(k))) return 0;
  const base = isWeekendDay(k, av) ? av.weekend.minutes : av.weekday.minutes;
  return base > 0 ? base + Math.max(0, extraPerDay) : 0;
}
export type Capacity = { total: number; days: number; studyDays: number; weekdayStudyDays: number; weekendStudyDays: number;
  restDays: number; perDay: { k: DateKey; min: number }[] };
/** Minutes available from `from` up to, but not including, `toExclusive` (usually the exam day). */
export function capacity(from: DateKey, toExclusive: DateKey | null, av: StudyAvailability, o: { extraPerDay?: number; todayKey?: DateKey; studiedTodayMin?: number; maxDays?: number } = {}): Capacity {
  const out: Capacity = { total: 0, days: 0, studyDays: 0, weekdayStudyDays: 0, weekendStudyDays: 0, restDays: 0, perDay: [] };
  if (!toExclusive) return out;
  const n = Math.min(o.maxDays || 3660, daysBetween(from, toExclusive));
  for (let i = 0; i < n; i++) {
    const k = addDays(from, i);
    let m = minutesOn(k, av, o.extraPerDay || 0);
    if (k === o.todayKey) m = Math.max(0, m - (o.studiedTodayMin || 0));
    out.perDay.push({ k, min: m }); out.days++;
    if (m > 0) { out.total += m; out.studyDays++; if (isWeekendDay(k, av)) out.weekendStudyDays++; else out.weekdayStudyDays++; }
    else if (av.restDays.includes(weekdayOf(k)) || av.unavailable.includes(k)) out.restDays++;
  }
  return out;
}

/* ------------------------------------------------------------------ workload */

export type ConceptWork = { state: number; viaLecture: boolean; imp: Level3; acc: number | null; accN: number; S: number | null };
export type LectureWork = { min: number | null; watched: boolean; studied: boolean; done: boolean };
export type SubjectWorkInput = { id: ID; name: string; imp: Level3; diff?: Level3; priority?: Level3; estHours?: number | null; studiedMin: number;
  concepts: ConceptWork[]; lectures: LectureWork[]; questions: { S: number | null }[]; openMistakes: { stage: number }[] };
export type SubjectWork = { id: ID; name: string; learnMin: number; practiceMin: number; revisionMin: number; mistakesMin: number; totalMin: number;
  source: 'estimate' | 'structure' | 'default'; optional: boolean; lecturesLeft: number; conceptsNew: number };
export type Workload = { subjects: SubjectWork[]; learnMin: number; practiceMin: number; revisionMin: number; mistakesMin: number; totalMin: number;
  optionalMin: number; assumptions: string[] };

/** How many spaced reviews fit before the exam if intervals roughly triple after each success. */
export function expectedReviews(startIvl: number, daysLeft: number): number {
  let t = 0, ivl = Math.max(1, startIvl), n = 0;
  while (t + ivl <= daysLeft && n < 12) { t += ivl; n++; ivl *= 3; }
  return n;
}
const DIFF: Record<number, number> = { 1: 0.85, 2: 1, 3: 1.25 };
const IMPF: Record<number, number> = { 1: 0.7, 2: 1, 3: 1.2 };

export function estimateWork(subjects: SubjectWorkInput[], o: { daysLeft: number; prep: PrepConfig; minPerReview: number }): Workload {
  const P = o.prep, D = Math.max(0, o.daysLeft);
  const assumptions = [
    `New concept: about ${P.minPerNewConcept} min to learn. Practice: about ${P.practiceMinPerConcept} min per concept until it is applied.`,
    `Lectures: their length plus ${Math.round(P.selfStudyRatio * 100)}% for self-study and 5 min of recall.`,
    `Revision: spaced reviews at about ${o.minPerReview} min each, intervals roughly tripling; saved questions at ${P.minPerQuestion} min per re-solve.`
  ];
  const out: SubjectWork[] = [];
  let usedDefault = false;
  for (const s of subjects) {
    const optional = P.dropLowImportance && s.imp === 1;
    const lecLeft = s.lectures.filter(l => !l.done);
    const lecMin = sum(lecLeft.map(l => { const d = l.min || P.defaultLectureMin; return (l.watched ? 0 : d) + (l.studied ? 0 : d * P.selfStudyRatio) + 5; }));
    const concepts = s.concepts.filter(c => !(P.dropLowImportance && c.imp === 1));
    const newConcepts = concepts.filter(c => c.state === 0 && !c.viaLecture);
    const structural = (lecMin + newConcepts.length * P.minPerNewConcept) * (DIFF[s.diff || 2] || 1);
    let learn: number, source: SubjectWork['source'];
    if (s.estHours && s.estHours > 0) { learn = Math.max(0, s.estHours * 60 - s.studiedMin); source = 'estimate'; }
    else if (s.concepts.length || s.lectures.length) { learn = structural; source = 'structure'; }
    else { learn = Math.max(0, P.defaultSubjectHours * 60 - s.studiedMin); source = 'default'; usedDefault = true; }
    let practice = 0;
    if (concepts.length) {
      for (const c of concepts) {
        const f = c.accN >= 10 && (c.acc || 0) >= 0.9 ? 0.3 : c.accN >= 5 && (c.acc ?? 1) < 0.6 ? 1.5 : 1;
        if (c.state < 5) practice += P.practiceMinPerConcept * (IMPF[c.imp] || 1) * f;
        else if ((c.acc ?? 1) < 0.75) practice += P.practiceMinPerConcept * 0.5;
      }
    } else practice = learn * 0.35;
    practice *= P.practiceScale;
    let revision = 0;
    if (concepts.length) {
      for (const c of concepts) revision += (c.S ? expectedReviews(c.S, D) : c.state > 0 ? expectedReviews(1, D) : expectedReviews(4, D / 2)) * o.minPerReview;
      if (D >= 7) revision += concepts.length * 2;   // one final pass over formula sheets and summaries
    } else revision = learn * 0.15;
    for (const q of s.questions) revision += expectedReviews(q.S || 1, D) * P.minPerQuestion;
    const mistakes = sum(s.openMistakes.map(m => Math.max(0, 4 - (m.stage || 0)) * 5));
    const w = optional ? { learn: 0, practice: 0 } : { learn, practice };
    out.push({ id: s.id, name: s.name, learnMin: Math.round(w.learn), practiceMin: Math.round(w.practice), revisionMin: Math.round(revision), mistakesMin: mistakes,
      totalMin: Math.round(w.learn + w.practice + revision + mistakes), source, optional, lecturesLeft: lecLeft.length, conceptsNew: newConcepts.length });
  }
  if (usedDefault) assumptions.push(`Subjects without topics, lectures or an estimate count as ${P.defaultSubjectHours} hours of learning. Add any of those to improve the estimate.`);
  const optionalMin = sum(subjects.map((s, i) => out[i].optional ? (s.estHours ? s.estHours * 60 : 0) : 0));
  return { subjects: out, learnMin: sum(out.map(x => x.learnMin)), practiceMin: sum(out.map(x => x.practiceMin)), revisionMin: sum(out.map(x => x.revisionMin)),
    mistakesMin: sum(out.map(x => x.mistakesMin)), totalMin: sum(out.map(x => x.totalMin)), optionalMin, assumptions };
}

/* ------------------------------------------------------------------ feasibility */

export type OptionKey = 'extra-daily' | 'extra-weekend' | 'more-days' | 'drop-optional' | 'prioritize' | 'reduce-practice' | 'accept';
export type FeasibilityOption = { key: OptionKey; label: string; detail: string; gainMin: number; closesGap: boolean; value?: number };
export type Feasibility = {
  status: 'ok' | 'tight' | 'short' | 'no-date' | 'past';
  requiredMin: number; availableMin: number; gapMin: number; bufferMin: number; coverage: number;
  studyDays: number; currentPerStudyDay: number; requiredPerStudyDay: number; extraPerStudyDay: number;
  options: FeasibilityOption[]; atRisk: { id: ID; name: string; min: number }[];
};
export function assessFeasibility(i: { work: Workload; cap: Capacity; av: StudyAvailability; daysLeft: number | null;
  subjects: { id: ID; name: string; imp: Level3; priority?: Level3 }[] }): Feasibility {
  const req = i.work.totalMin, avail = i.cap.total;
  const base: Feasibility = { status: 'ok', requiredMin: req, availableMin: avail, gapMin: Math.max(0, req - avail), bufferMin: Math.max(0, avail - req),
    coverage: req ? Math.min(1, avail / req) : 1, studyDays: i.cap.studyDays, currentPerStudyDay: i.cap.studyDays ? avail / i.cap.studyDays : 0,
    requiredPerStudyDay: i.cap.studyDays ? req / i.cap.studyDays : req, extraPerStudyDay: 0, options: [], atRisk: [] };
  if (i.daysLeft == null) return { ...base, status: 'no-date' };
  if (i.daysLeft <= 0) return { ...base, status: 'past' };
  if (req <= avail) return { ...base, status: avail - req < req * 0.1 ? 'tight' : 'ok' };
  const gap = req - avail, opts: FeasibilityOption[] = [];
  const h = (m: number) => fmtH(m);
  const studyDays = i.cap.studyDays || 0;
  const extra = studyDays ? r5(gap / studyDays) : 0;
  if (studyDays) opts.push({ key: 'extra-daily', value: extra, gainMin: extra * studyDays, closesGap: true,
    label: `Add ${extra} minutes a day`, detail: `${h(base.currentPerStudyDay)} becomes ${h(base.currentPerStudyDay + extra)} on each of ${studyDays} study days.` });
  if (i.cap.weekendStudyDays) {
    const we = r5(gap / i.cap.weekendStudyDays);
    if (we <= 8 * 60) opts.push({ key: 'extra-weekend', value: we, gainMin: we * i.cap.weekendStudyDays, closesGap: true,
      label: `Add ${h(we)} on weekend days`, detail: `Only weekends change: ${i.cap.weekendStudyDays} weekend days until the exam.` });
  }
  const restGain = sum(i.cap.perDay.filter(d => d.min === 0 && i.av.restDays.includes(weekdayOf(d.k)) && !i.av.unavailable.includes(d.k))
    .map(d => isWeekendDay(d.k, i.av) ? i.av.weekend.minutes : i.av.weekday.minutes));
  if (restGain > 0) opts.push({ key: 'more-days', gainMin: restGain, closesGap: restGain >= gap,
    label: 'Study on your rest days too', detail: `Adds about ${h(restGain)}.` });
  const optionalGain = sum(i.work.subjects.filter((s, k) => i.subjects[k] && i.subjects[k].imp === 1 && !s.optional).map(s => s.learnMin + s.practiceMin));
  if (optionalGain > 0) opts.push({ key: 'drop-optional', gainMin: optionalGain, closesGap: optionalGain >= gap,
    label: 'Leave out low-importance content', detail: `Saves about ${h(optionalGain)} from subjects marked low importance.` });
  const practiceGain = Math.round(i.work.practiceMin * 0.4);
  if (practiceGain > 0) opts.push({ key: 'reduce-practice', gainMin: practiceGain, closesGap: practiceGain >= gap,
    label: 'Lower the practice target', detail: `Plan 60% of the practice estimate. Saves about ${h(practiceGain)}; application may suffer.` });
  // What would be left out if nothing changes: lowest importance and priority first.
  const order = i.work.subjects.map((s, k) => ({ s, meta: i.subjects[k] || { imp: 2, priority: 2 } }))
    .sort((a, b) => (a.meta.imp - b.meta.imp) || ((a.meta.priority || 2) - (b.meta.priority || 2)));
  let left = gap; const atRisk: Feasibility['atRisk'] = [];
  for (const x of order) { if (left <= 0) break; const m = x.s.learnMin + x.s.practiceMin; if (m <= 0) continue; atRisk.push({ id: x.s.id, name: x.s.name, min: Math.min(m, left) }); left -= m; }
  opts.push({ key: 'prioritize', gainMin: 0, closesGap: false, label: 'Put important subjects first',
    detail: atRisk.length ? `The shortfall then falls on ${atRisk.map(a => a.name).join(', ')}.` : 'The shortfall falls on the least important content.' });
  opts.push({ key: 'accept', gainMin: 0, closesGap: false, label: 'Keep this schedule and accept incomplete coverage',
    detail: `About ${Math.round(base.coverage * 100)}% of the estimated work fits before the exam.` });
  return { ...base, status: 'short', extraPerStudyDay: extra, options: opts, atRisk };
}
export function fmtH(min: number): string {
  const m = Math.round(Math.max(0, min)), h = Math.floor(m / 60), r = m % 60;
  return h && r ? h + 'h ' + String(r).padStart(2, '0') + 'm' : h ? h + 'h' : r + 'm';
}
/** Normal plan against the extra-effort plan, side by side. */
export function effortComparison(f: Feasibility) {
  return { normal: { perDay: f.currentPerStudyDay, coverage: f.coverage }, extra: { perDay: f.currentPerStudyDay + f.extraPerStudyDay, coverage: 1, extra: f.extraPerStudyDay } };
}

/* ------------------------------------------------------------------ phases */

type PhaseDef = [RoadmapPhaseKey, number];
const PHASE_DESC: Record<RoadmapPhaseKey, string> = {
  foundation: 'Learn new concepts in prerequisite order, with recall from the first day.',
  coverage: 'Finish the remaining syllabus while practice grows.',
  practice: 'Most time goes to problem solving and application; new learning tapers off.',
  revision: 'Recover older material across subjects; mixed practice and question review.',
  final: 'High-value revision, mistakes, saved questions and mock tests. Little or no new content.'
};
const MIXKEY: Record<RoadmapPhaseKey, 'early' | 'middle' | 'final'> = { foundation: 'early', coverage: 'middle', practice: 'middle', revision: 'final', final: 'final' };
/** Phases from the start of preparation to the day before the exam. Shorter preparations get fewer, compressed phases. */
export function buildPhases(start: DateKey, exam: DateKey): RoadmapPhase[] {
  const T = daysBetween(start, exam);
  if (T <= 0) return [];
  const defs: PhaseDef[] = T <= 7 ? [['final', 1]]
    : T <= 21 ? [['coverage', 0.25], ['practice', 0.45], ['final', 0.30]]
    : T <= 60 ? [['coverage', 0.35], ['practice', 0.30], ['revision', 0.20], ['final', 0.15]]
    : T <= 180 ? [['foundation', 0.35], ['coverage', 0.20], ['practice', 0.20], ['revision', 0.15], ['final', 0.10]]
    : [['foundation', 0.45], ['coverage', 0.20], ['practice', 0.15], ['revision', 0.12], ['final', 0.08]];
  const name = (k: RoadmapPhaseKey) => k === 'coverage' && T <= 60 ? 'Learning and coverage' : k === 'practice' && T <= 21 ? 'Practice and revision'
    : ({ foundation: 'Foundation', coverage: 'Coverage', practice: 'Practice', revision: 'Revision', final: 'Final preparation' } as const)[k];
  const out: RoadmapPhase[] = []; let acc = 0, prev = 0;
  defs.forEach(([k, f], i) => {
    acc += f; const endIdx = i === defs.length - 1 ? T : Math.max(prev + 1, Math.round(acc * T));
    if (endIdx <= prev) return;
    out.push({ key: k, name: name(k), start: addDays(start, prev), end: addDays(start, endIdx - 1), desc: PHASE_DESC[k], mixKey: MIXKEY[k] });
    prev = endIdx;
  });
  return out;
}
export function phaseOn(phases: RoadmapPhase[], k: DateKey): RoadmapPhase | null {
  return phases.find(p => k >= p.start && k <= p.end) || (phases.length && k > phases[phases.length - 1].end ? phases[phases.length - 1] : null);
}
/** Last day planned for new learning: the end of the coverage phase (or of the practice phase in short preparations). */
export function coverageEnd(phases: RoadmapPhase[]): DateKey | null {
  const c = phases.find(p => p.key === 'coverage') || phases.find(p => p.key === 'foundation');
  return c ? c.end : phases.length ? phases[0].end : null;
}

/* ------------------------------------------------------------------ adaptive mix */

export type Mix = { review: number; new: number; practice: number; mistakes: number; cumulative: number };
/** Share of a day's time for new learning so that what is left can be learned by the end of coverage. */
export function learnShare(phase: RoadmapPhaseKey | null, required: number, base: Mix): number {
  if (required <= 0) return 0;
  switch (phase) {
    case 'foundation': case 'coverage': return clamp(required, base.new * 0.5, 0.65);
    case 'practice': return clamp(required, 0, 0.4);
    case 'revision': return clamp(required, 0, 0.2);
    case 'final': return Math.min(base.new, required, 0.1);
    default: return clamp(required, 0, 0.65);
  }
}
/** Scales the planner mix so new learning matches what the remaining syllabus needs; the rest is redistributed. */
export function adaptMix(base: Mix, newShare: number): Mix {
  const rest = 1 - base.new, target = clamp(newShare, 0, 0.9);
  if (rest <= 0) return { ...base, new: target };
  const k = (1 - target) / rest;
  return { review: base.review * k, new: target, practice: base.practice * k, mistakes: base.mistakes * k, cumulative: base.cumulative * k };
}
export function requiredLearnShare(learnRemainingMin: number, cap: Capacity, until: DateKey | null): number {
  if (learnRemainingMin <= 0) return 0;
  const avail = sum(cap.perDay.filter(d => !until || d.k <= until).map(d => d.min));
  return avail > 0 ? learnRemainingMin / avail : 1;
}

/* ------------------------------------------------------------------ subject order and timeline */

export type SubjectRef = { id: ID; name: string; order: number; imp: Level3; priority?: Level3; prereqSubjects?: ID[]; targetDate?: DateKey | null };
/** Prerequisites first; among subjects that are free to start, higher priority, then importance, then your order. */
export function subjectOrder(subjects: SubjectRef[]): ID[] {
  const ids = new Set(subjects.map(s => s.id)), left = new Map(subjects.map(s => [s.id, s]));
  const deps = (s: SubjectRef) => (s.prereqSubjects || []).filter(p => ids.has(p) && p !== s.id);
  const done = new Set<ID>(), out: ID[] = [];
  const rank = (a: SubjectRef, b: SubjectRef) => ((b.priority || 2) - (a.priority || 2)) || (b.imp - a.imp) || (a.order - b.order);
  while (left.size) {
    const ready = [...left.values()].filter(s => deps(s).every(d => done.has(d))).sort(rank);
    const pick = ready[0] || [...left.values()].sort(rank)[0];          // a cycle: break it by rank
    out.push(pick.id); done.add(pick.id); left.delete(pick.id);
  }
  return out;
}
export type TimelineRow = { id: ID; start: DateKey | null; end: DateKey | null; finished: boolean; learnMin: number };
/**
 * Spreads each subject's learning over the days, `parallel` subjects at a time in roadmap order (0 = all at once,
 * weighted by planned share). A subject waits for its prerequisite subjects to be half done.
 */
export function subjectTimeline(i: { order: ID[]; learnMin: Record<ID, number>; weight?: Record<ID, number>; prereq?: Record<ID, ID[]>;
  days: { k: DateKey; learn: number }[]; parallel: number }): { rows: Record<ID, TimelineRow>; end: DateKey | null } {
  const rows: Record<ID, TimelineRow> = {}, left: Record<ID, number> = {};
  for (const id of i.order) { rows[id] = { id, start: null, end: null, finished: false, learnMin: i.learnMin[id] || 0 }; left[id] = i.learnMin[id] || 0; if (left[id] <= 0) rows[id].finished = true; }
  const k = i.parallel > 0 ? i.parallel : i.order.length;
  const half = (id: ID) => rows[id].finished || (rows[id].learnMin > 0 && left[id] <= rows[id].learnMin / 2);
  for (const d of i.days) {
    let pool = d.learn; if (pool <= 0) continue;
    const pending = i.order.filter(id => left[id] > 0);
    if (!pending.length) break;
    const ready = pending.filter(id => (i.prereq?.[id] || []).every(p => !rows[p] || half(p)));
    const active = (ready.length ? ready : pending).slice(0, k);
    for (let guard = 0; guard < 4 && pool > 0.5; guard++) {
      const still = active.filter(id => left[id] > 0); if (!still.length) break;
      const wsum = sum(still.map(id => i.parallel > 0 ? 1 : (i.weight?.[id] || 1)));
      let used = 0;
      for (const id of still) {
        const give = Math.min(left[id], pool * (i.parallel > 0 ? 1 : (i.weight?.[id] || 1)) / wsum);
        if (give <= 0) continue;
        if (!rows[id].start) rows[id].start = d.k;
        left[id] -= give; used += give;
        if (left[id] <= 0.5) { left[id] = 0; rows[id].end = d.k; rows[id].finished = true; }
      }
      pool -= used; if (used <= 0) break;
    }
  }
  const all = i.order.every(id => rows[id].finished);
  const ends = i.order.map(id => rows[id].end).filter(Boolean) as DateKey[];
  return { rows, end: all ? (ends.sort().pop() || null) : null };
}
/** Lecture dates for the baseline: each subject's lectures spread evenly across its learning window. */
export function lectureDates(lecturesBySubject: Record<ID, ID[]>, rows: Record<ID, TimelineRow>, days: { k: DateKey; learn: number }[]): Record<ID, DateKey> {
  const out: Record<ID, DateKey> = {};
  for (const sid in lecturesBySubject) {
    const r = rows[sid], ls = lecturesBySubject[sid]; if (!r || !r.start || !ls.length) continue;
    const window = days.filter(d => d.k >= r.start! && (!r.end || d.k <= r.end) && d.learn > 0).map(d => d.k);
    if (!window.length) continue;
    ls.forEach((lid, n) => { out[lid] = window[Math.min(window.length - 1, Math.max(0, Math.ceil((n + 1) * window.length / ls.length) - 1))]; });
  }
  return out;
}

/* ------------------------------------------------------------------ forecast */

export type Forecast = { completion: DateKey | null; target: DateKey | null; status: 'done' | 'ahead' | 'on-track' | 'behind' | 'unknown';
  daysDiff: number; extraMinPerDay: number; recentCompletion: DateKey | null };
/** When new learning should be finished at the planned pace, compared with the end of the coverage phase. */
export function forecastCompletion(i: { today: DateKey; learnRemainingMin: number; days: { k: DateKey; min: number }[]; phases: RoadmapPhase[];
  base?: Mix; recentLearnMinPerDay?: number }): Forecast {
  const target = coverageEnd(i.phases);
  const base = i.base || (DEFAULT_MIX.middle as Mix);
  const recentCompletion = i.learnRemainingMin <= 0 ? i.today : i.recentLearnMinPerDay && i.recentLearnMinPerDay > 0
    ? addDays(i.today, Math.ceil(i.learnRemainingMin / i.recentLearnMinPerDay)) : null;
  if (i.learnRemainingMin <= 0) return { completion: i.today, target, status: 'done', daysDiff: 0, extraMinPerDay: 0, recentCompletion };
  const req = requiredLearnShare(i.learnRemainingMin, { perDay: i.days } as Capacity, target);
  let left = i.learnRemainingMin, completion: DateKey | null = null;
  for (const d of i.days) {
    const ph = phaseOn(i.phases, d.k);
    left -= d.min * learnShare(ph ? ph.key : null, req, base);
    if (left <= 0) { completion = d.k; break; }
  }
  if (!target) return { completion, target, status: completion ? 'on-track' : 'unknown', daysDiff: 0, extraMinPerDay: 0, recentCompletion };
  if (!completion) {
    const upto = i.days.filter(d => d.k <= target);
    const shares = upto.map(d => { const ph = phaseOn(i.phases, d.k); return learnShare(ph ? ph.key : null, req, base); });
    const got = sum(upto.map((d, n) => d.min * shares[n])), sdays = sum(upto.map((d, n) => d.min > 0 ? shares[n] : 0));
    const extra = sdays > 0 ? r5((i.learnRemainingMin - got) / sdays) : 0;
    return { completion: null, target, status: 'behind', daysDiff: i.days.length ? daysBetween(target, i.days[i.days.length - 1].k) + 1 : 0, extraMinPerDay: extra, recentCompletion };
  }
  const diff = daysBetween(target, completion);
  let extra = 0;
  if (diff > 0) {
    const upto = i.days.filter(d => d.k <= target);
    const shares = upto.map(d => { const ph = phaseOn(i.phases, d.k); return learnShare(ph ? ph.key : null, req, base); });
    const got = sum(upto.map((d, n) => d.min * shares[n])), sdays = sum(upto.map((d, n) => d.min > 0 ? shares[n] : 0));
    extra = sdays > 0 ? r5((i.learnRemainingMin - got) / sdays) : 0;
  }
  return { completion, target, status: diff > 3 ? 'behind' : diff < -3 ? 'ahead' : 'on-track', daysDiff: diff, extraMinPerDay: extra, recentCompletion };
}

/* ------------------------------------------------------------------ weekly review */

export type WeekInput = { from: DateKey; to: DateKey; plannedMin: number; studiedMin: number;
  tasksDone: number; tasksSkipped: number; tasksPlanned: number; lecturesDone: number;
  questions: { attempted: number; correct: number }; reviews: { done: number; ok: number }; mistakesResolved: number;
  subjects: { id: ID; name: string; min: number; targetShare: number; accuracy: number | null; evidence: number }[];
  backlog: { overdueReviews: number; overdueQuestions: number; lecturesBehind: number; mistakesDue: number };
  nextWeek: { availableMin: number; studyDays: number; lectureTarget: number; reviewsDue: number } };
export type WeekReview = WeekInput & { accuracy: number | null; strongest: string | null; weakest: string | null; completion: number | null;
  focus: { subjects: string[]; minutesPerDay: number; lectures: number; questions: number; notes: string[] } };
export function buildWeeklyReview(w: WeekInput): WeekReview {
  const ev = w.subjects.filter(s => s.evidence >= 5 && s.accuracy != null).sort((a, b) => (b.accuracy! - a.accuracy!));
  const strongest = ev.length ? ev[0].name : null, weakest = ev.length > 1 ? ev[ev.length - 1].name : null;
  const tot = sum(w.subjects.map(s => s.min)) || 1;
  const gaps = w.subjects.map(s => ({ s, gap: s.targetShare - s.min / tot + (s.accuracy != null && s.evidence >= 5 && s.accuracy < 0.6 ? 0.1 : 0) }))
    .sort((a, b) => b.gap - a.gap).filter(x => x.gap > 0.03).slice(0, 2).map(x => x.s.name);
  const notes: string[] = [];
  const completion = w.tasksPlanned ? w.tasksDone / w.tasksPlanned : null;
  if (w.plannedMin && w.studiedMin < w.plannedMin * 0.7) notes.push(`You studied ${fmtH(w.studiedMin)} of ${fmtH(w.plannedMin)} planned. If the plan is too full, lower your daily time in Settings so the roadmap stays honest.`);
  if (w.tasksPlanned && w.tasksSkipped / w.tasksPlanned > 0.3) notes.push('More than a third of tasks were skipped. Protect your study windows, or plan fewer subjects a day.');
  if (w.backlog.overdueReviews > 20) notes.push(`${w.backlog.overdueReviews} reviews are overdue. Start sessions with the critical ones before new material.`);
  if (w.backlog.lecturesBehind > 0) notes.push(`Lectures are ${w.backlog.lecturesBehind} behind the roadmap.`);
  if (w.questions.attempted && w.questions.correct / w.questions.attempted < 0.6) notes.push('Question accuracy was below 60%. Retry the wrong ones before adding new questions.');
  const qTarget = Math.max(10, Math.round((w.questions.attempted || w.nextWeek.studyDays * 5) * 1.1));
  return { ...w, accuracy: w.questions.attempted ? w.questions.correct / w.questions.attempted : null, strongest, weakest, completion,
    focus: { subjects: gaps, minutesPerDay: w.nextWeek.studyDays ? Math.round(w.nextWeek.availableMin / w.nextWeek.studyDays) : 0,
      lectures: w.nextWeek.lectureTarget, questions: qTarget, notes } };
}
