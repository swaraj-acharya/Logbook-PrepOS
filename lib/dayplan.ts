/*
 * Day-wise planning.
 *
 * buildDay extends the existing planner (engine.planDay) rather than replacing it:
 *   1. choose the day's subjects by controlled rotation (target share, recency, priority, prerequisites, deadlines)
 *   2. reserve time for question review and, in lecture mode, lecture bundles: watch → self-study → recall
 *   3. let planDay split the rest into review, new learning, practice, mistakes and cumulative recall
 *   4. explain every task, then place tasks into the day's study windows
 * projectDays repeats this for the coming days on a simulated copy of the data, so the week ahead reflects what
 * each day will have covered. Locked, edited, done and skipped tasks are never replaced by regeneration.
 */
import { planDay, reviewPriority, Memory, addDays, dayStart, dayKey, daysBetween, DAY, HOUR } from './engine.js';
import { clockToMin, minToClock } from './dates';
import { adaptMix, minutesOn, type Mix } from './roadmap';
import type { DateKey, DayTask, ID, Level3, MemoryRecord, PlanHistoryEntry, PrepConfig, RoadmapPhase, StudyAvailability, TimeWindow } from './types';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const f5 = (n: number) => Math.floor(Math.max(0, n) / 5) * 5;
const r5 = (n: number) => Math.round(Math.max(0, n) / 5) * 5;
const pct = (x: number) => Math.round(x * 100) + '%';
const plural = (n: number, w: string, p?: string) => n + ' ' + (n === 1 ? w : (p || w + 's'));
export const RETRY_DAYS = [1, 3, 7, 21];

/* ------------------------------------------------------------------ the planning snapshot */

export type PlanConcept = { id: ID; sid: ID; order: number; name: string; prereq: ID[]; imp: Level3; state: number; mem: MemoryRecord | null;
  practice: { n: number; c: number; at: number }[]; formula: boolean; viaLecture: boolean; lapses?: number };
export type PlanSubject = { id: ID; name: string; order: number; imp: Level3; priority: Level3; share: number; prereqSubjects: ID[];
  targetDate?: DateKey | null; learnedFrac: number; learnLeftMin: number };
export type PlanLecture = { id: ID; sid: ID; order: number; label: string; min: number | null; cids: ID[];
  watched: boolean; studied: boolean; recalled: boolean; done: boolean; watchedAt?: number | null };
export type PlanMistake = { id: ID; cid: ID | null; sid: ID | null; next: number; stage: number };
export type PlanQuestion = { id: ID; sid: ID | null; cid: ID | null; mem: MemoryRecord | null; recentWrong: boolean };
export type Snapshot = {
  now: number; today: DateKey; sh: number;
  subjects: PlanSubject[]; concepts: PlanConcept[]; lectures: PlanLecture[]; mistakes: PlanMistake[]; questions: PlanQuestion[];
  exposure: Record<DateKey, Record<ID, number>>;   // minutes per subject per day, recent days
  lastStudied: Record<ID, DateKey>; lastStudyGapDays: number;
  weights: Record<string, number>; minPerReview: number; memOpts: { retention: number; sh: number; maxIvl: number };
};
export type DayOptions = {
  minutes: number; windows: TimeWindow[]; fromMin?: number | null;
  phase: RoadmapPhase | null; mixKey: 'early' | 'middle' | 'final'; mix: Mix; daysLeft: number | null;
  prep: PrepConfig; subjectsPerDay: number; minSession?: number; keep?: DayTask[]; recoveryDays?: number; id?: (p: string) => string;
};
export type DayResult = { date: DateKey; tasks: DayTask[]; notes: string[]; subjects: { id: ID; why: string[] }[];
  minutes: number; plannedMin: number; phase: string; unscheduledMin: number };

const endOf = (k: DateKey, sh: number) => dayStart(addDays(k, 1), sh);
const startOf = (k: DateKey, sh: number) => dayStart(k, sh);
function dayTime(snap: Snapshot, k: DateKey) { return k === snap.today ? snap.now : startOf(k, snap.sh) + 10 * HOUR; }

/* ------------------------------------------------------------------ candidates (the former planCtx, now pure) */

export type Candidates = {
  due: any[]; newCands: { cid: ID; sid: ID }[]; practiceCands: { cid: ID; sid: ID; factor: number; note: string }[];
  mistakesDue: { id: ID; cid: ID | null }[]; cumulativeCands: { cid: ID; sid: ID }[]; formulaCands: { cid: ID; sid: ID }[];
  deficit: Record<ID, number>; share: Record<ID, number>; recentShare: Record<ID, number>;
};
export function exposureWindow(snap: Snapshot, k: DateKey, days: number): Record<ID, number> {
  const out: Record<ID, number> = {};
  for (let i = 0; i < days; i++) { const e = snap.exposure[addDays(k, -i)]; if (e) for (const s in e) out[s] = (out[s] || 0) + e[s]; }
  return out;
}
function practiceFactor(c: PlanConcept): { acc: number | null; factor: number; note: string } {
  const recent = c.practice.slice(-20), n = sum(recent.map(p => p.n)), cc = sum(recent.map(p => p.c));
  if (!n) return { acc: null, factor: 1, note: '' };
  const acc = cc / n, R = c.mem ? null : null;
  if (n >= 5 && acc < 0.6 && c.state >= 2) return { acc, factor: 1.8, note: `${c.name}: understood, but ${pct(acc)} on ${Math.round(n)} questions` };
  if (n >= 10 && acc >= 0.9) return { acc, factor: 0.3, note: '' };
  return { acc, factor: R == null && acc < 0.75 ? 1.2 : 1, note: '' };
}
export function candidates(snap: Snapshot, k: DateKey, o: { subjectFilter?: Set<ID> | null; lectureMode?: boolean } = {}): Candidates {
  const sh = snap.sh, now = dayTime(snap, k), endK = endOf(k, sh), startK = startOf(k, sh);
  const subs = snap.subjects, byC: Record<ID, PlanConcept> = {};
  snap.concepts.forEach(c => { byC[c.id] = c; });
  const wk = exposureWindow(snap, k, 7);
  const shareTot = sum(subs.map(s => s.share)) || 1, secTot = sum(subs.map(s => wk[s.id] || 0));
  const deficit: Record<ID, number> = {}, share: Record<ID, number> = {}, recentShare: Record<ID, number> = {};
  subs.forEach(s => { share[s.id] = s.share / shareTot; recentShare[s.id] = secTot ? (wk[s.id] || 0) / secTot : 0; deficit[s.id] = share[s.id] - recentShare[s.id]; });
  const orderOf = (id: ID) => byC[id] ? byC[id].order : 1e9;
  const cs = snap.concepts;
  const prereqOK = (c: PlanConcept) => c.prereq.every(p => !byC[p] || byC[p].state >= 1);
  const started: Record<ID, boolean> = {}; cs.forEach(c => { if (c.state >= 1) started[c.sid] = true; });
  const fresh = cs.filter(c => c.state === 0 && !(o.lectureMode && c.viaLecture));
  const pri = (sid: ID) => (deficit[sid] || 0) + (started[sid] ? 0.05 : 0);
  const subOrder = [...new Set(fresh.map(c => c.sid))].sort((a, b) => (pri(b) - pri(a)) || (sOrder(snap, a) - sOrder(snap, b)));
  const queues = subOrder.map(sid => fresh.filter(c => c.sid === sid).sort((a, b) => (Number(prereqOK(b)) - Number(prereqOK(a))) || (a.order - b.order)));
  const newList: PlanConcept[] = [];
  const top = queues.slice(0, 2), rest = queues.slice(2);
  let more = true; while (more) { more = false; for (const q of top) if (q.length) { newList.push(q.shift() as PlanConcept); more = true; } }
  rest.forEach(q => newList.push(...q));
  let newCands = newList.map(c => ({ cid: c.id, sid: c.sid }));
  if (o.subjectFilter) newCands = newCands.filter(c => o.subjectFilter!.has(c.sid));
  const targets = new Set(cs.filter(c => c.state >= 1 && c.state <= 3).map(c => c.id).concat(newCands.slice(0, 5).map(x => x.cid)));
  const dependents: Record<ID, ID[]> = {}; cs.forEach(c => c.prereq.forEach(p => (dependents[p] || (dependents[p] = [])).push(c.id)));
  const isPrereq = (cid: ID) => (dependents[cid] || []).some(x => targets.has(x));
  const due = cs.filter(c => c.mem && c.mem.due < endK).map(c => {
    const m = c.mem as MemoryRecord, R = Memory.recall(m, now);
    const it: any = { cid: c.id, sid: c.sid, R, overdueDays: Math.max(0, daysBetween(dayKey(m.due, sh), k)), ivl: m.ivl || 1, imp: c.imp, lapses: m.lapses || 0, isPrereq: isPrereq(c.id), overdue: m.due < startK };
    it.score = reviewPriority(it, snap.weights);
    it.critical = it.overdue && ((R != null && R < 0.7) || it.imp === 3 || it.isPrereq);
    return it;
  }).sort((a, b) => b.score - a.score);
  let practiceCands = cs.filter(c => { if (c.state < 2 || c.state > 5) return false; const f = practiceFactor(c); return f.acc == null || f.acc < 0.75 || c.state < 5; })
    .map(c => ({ c, f: practiceFactor(c) }))
    .sort((a, b) => ((deficit[b.c.sid] || 0) - (deficit[a.c.sid] || 0)) || (b.f.factor - a.f.factor) || ((a.f.acc ?? -1) - (b.f.acc ?? -1)))
    .map(x => ({ cid: x.c.id, sid: x.c.sid, factor: x.f.factor, note: x.f.note }));
  if (o.subjectFilter) { const inF = practiceCands.filter(c => o.subjectFilter!.has(c.sid)); practiceCands = inF.concat(practiceCands.filter(c => !o.subjectFilter!.has(c.sid) && c.factor > 1.5)); }
  practiceCands.sort((a, b) => (b.factor > 1.5 ? 1 : 0) - (a.factor > 1.5 ? 1 : 0));
  const mistakesDue = snap.mistakes.filter(m => m.next < endK).map(m => ({ id: m.id, cid: m.cid }));
  const older = cs.filter(c => c.state >= 3 && c.mem && c.mem.due >= endK && c.mem.last && now - c.mem.last > 5 * DAY)
    .sort((a, b) => (a.mem!.last || 0) - (b.mem!.last || 0));
  const bySub: Record<ID, PlanConcept[]> = {}; older.forEach(c => (bySub[c.sid] || (bySub[c.sid] = [])).push(c));
  const cumulativeCands: { cid: ID; sid: ID }[] = []; more = true;
  while (more && cumulativeCands.length < 20) { more = false; for (const s in bySub) if (bySub[s].length) { const c = bySub[s].shift() as PlanConcept; cumulativeCands.push({ cid: c.id, sid: s }); more = true; } }
  const formulaCands = cs.filter(c => c.state >= 1 && c.formula).map(c => ({ cid: c.id, sid: c.sid }));
  return { due, newCands, practiceCands, mistakesDue, cumulativeCands, formulaCands, deficit, share, recentShare };
}
function sOrder(snap: Snapshot, sid: ID) { const s = snap.subjects.find(x => x.id === sid); return s ? s.order : 1e9; }

/* ------------------------------------------------------------------ subject rotation */

export type SubjectPick = { ids: ID[]; why: Record<ID, string[]>; scores: Record<ID, number> };
/**
 * Picks the day's subjects. Score = gap between planned and recent share + days since last studied + priority,
 * importance, prerequisites, weak practice, near target dates and unfinished lectures. n = 0 means no limit.
 */
export function pickSubjects(snap: Snapshot, k: DateKey, n: number, o: { lectureMode?: boolean; daysLeft?: number | null } = {}): SubjectPick {
  const C = candidates(snap, k, { lectureMode: o.lectureMode });
  const byS: Record<ID, PlanSubject> = {}; snap.subjects.forEach(s => { byS[s.id] = s; });
  const hasNew = new Set(C.newCands.map(c => c.sid)), hasPractice = new Set(C.practiceCands.map(c => c.sid));
  const lecLeft: Record<ID, number> = {}, pending: Record<ID, PlanLecture> = {};
  for (const l of snap.lectures) { if (!l.done) lecLeft[l.sid] = (lecLeft[l.sid] || 0) + 1; if (l.watched && !l.done && !pending[l.sid]) pending[l.sid] = l; }
  const dueBy: Record<ID, number> = {}; C.due.forEach(d => { dueBy[d.sid] = (dueBy[d.sid] || 0) + 1; });
  const dependents: Record<ID, ID[]> = {}; snap.subjects.forEach(s => s.prereqSubjects.forEach(p => (dependents[p] || (dependents[p] = [])).push(s.id)));
  const scores: Record<ID, number> = {}, why: Record<ID, string[]> = {};
  // the subject that got the most time yesterday gives way a little, so limited days rotate
  const y = snap.exposure[addDays(k, -1)] || {};
  const yMain = Object.keys(y).filter(s => y[s] >= 30).sort((a, b) => y[b] - y[a])[0];
  const eligible = snap.subjects.filter(s => hasNew.has(s.id) || hasPractice.has(s.id) || (o.lectureMode && lecLeft[s.id]) || s.learnLeftMin > 0);
  for (const s of eligible) {
    const w: string[] = [];
    let sc = C.deficit[s.id] || 0;
    if (sc > 0.05) w.push(`below its target share (${pct(C.recentShare[s.id])} of the last week against ${pct(C.share[s.id])} planned)`);
    const last = snap.lastStudied[s.id], gap = last ? daysBetween(last, k) : null;
    sc += gap == null ? 0.15 : Math.min(0.15, 0.05 * Math.max(0, gap));
    if (n > 0 && s.id === yMain) { sc -= 0.07; }
    if (gap == null) w.push('not started yet'); else if (gap >= 3) w.push(`not studied for ${gap} days`);
    sc += ((s.priority || 2) - 2) * 0.06 + ((s.imp || 2) - 2) * 0.04;
    if (s.priority === 3) w.push('high priority'); if (s.imp === 3) w.push('high importance for the exam');
    const blockers = s.prereqSubjects.map(p => byS[p]).filter(p => p && p.learnedFrac < 0.5);
    if (blockers.length) { sc -= 0.3; w.push('waits for ' + blockers.map(b => b.name).join(', ')); }
    const deps = (dependents[s.id] || []).map(d => byS[d]).filter(d => d && d.learnedFrac < 0.2);
    if (deps.length && s.learnedFrac < 1) { sc += Math.min(0.1, deps.length * 0.03); w.push('prerequisite for ' + deps.slice(0, 2).map(d => d.name).join(' and ')); }
    if (s.targetDate && s.learnLeftMin > 0) { const left = daysBetween(k, s.targetDate); if (left >= 0 && left <= 21) { sc += 0.15; w.push(`target date ${s.targetDate} is ${left === 0 ? 'today' : 'in ' + plural(left, 'day')}`); } }
    if (o.lectureMode && pending[s.id]) { sc += 0.25; w.push(`${pending[s.id].label} was watched but not yet consolidated`); }
    const weak = C.practiceCands.filter(p => p.sid === s.id && p.factor > 1.5).length;
    if (weak) { sc += 0.05; w.push(plural(weak, 'concept') + ' with weak application'); }
    if (dueBy[s.id]) { sc += Math.min(10, dueBy[s.id]) * 0.005; w.push(plural(dueBy[s.id], 'revision item') + ' due'); }
    if (!hasNew.has(s.id) && !(o.lectureMode && lecLeft[s.id]) && !hasPractice.has(s.id)) sc -= 0.5;
    scores[s.id] = sc; why[s.id] = w;
  }
  const ranked = eligible.slice().sort((a, b) => (scores[b.id] - scores[a.id]) || (a.order - b.order));
  const ids = (n > 0 ? ranked.slice(0, n) : ranked).map(s => s.id);
  if (o.daysLeft != null && o.daysLeft >= 0) ids.forEach(id => why[id].push(plural(o.daysLeft as number, 'day') + ' remaining'));
  return { ids, why, scores };
}

/* ------------------------------------------------------------------ building one day */

type Bundle = { l: PlanLecture; watch: number; self: number; rec: number; partial: boolean; consolidate: boolean };
function lectureBundles(snap: Snapshot, subjectIds: ID[] | null, budget: number, total: number, o: DayOptions): Bundle[] {
  const P = o.prep, out: Bundle[] = [];
  let used = 0;
  const dur = (l: PlanLecture) => l.min && l.min > 0 ? l.min : P.defaultLectureMin;
  const selfOf = (l: PlanLecture) => Math.max(10, r5(dur(l) * P.selfStudyRatio));
  const pending = snap.lectures.filter(l => l.watched && !l.done).sort((a, b) => (a.watchedAt || 0) - (b.watchedAt || 0)).slice(0, 2);
  for (const l of pending) {
    const self = l.studied ? 0 : selfOf(l), rec = l.recalled ? 0 : 5;
    if (self + rec <= 0 || used + self + rec > total) continue;
    out.push({ l, watch: 0, self, rec, partial: false, consolidate: true }); used += self + rec;
  }
  const allowed = (sid: ID) => !subjectIds || subjectIds.includes(sid);
  const queues: Record<ID, PlanLecture[]> = {};
  for (const l of snap.lectures.filter(x => !x.watched && !x.done && allowed(x.sid)).sort((a, b) => a.order - b.order)) (queues[l.sid] || (queues[l.sid] = [])).push(l);
  const order = (subjectIds || Object.keys(queues)).filter(s => queues[s] && queues[s].length);
  let fresh = 0, more = true;
  while (more) {
    more = false;
    for (const sid of order) {
      const l = queues[sid][0]; if (!l) continue;
      const self = selfOf(l), rec = dur(l) >= 45 ? 10 : 5, size = dur(l) + self + rec;
      if (used + size <= budget || (!fresh && used + size <= total && o.mixKey !== 'final')) {
        out.push({ l, watch: dur(l), self, rec, partial: false, consolidate: false }); used += size; fresh++; queues[sid].shift(); more = true;
      } else if (!fresh && o.mixKey !== 'final') {
        const w = f5(Math.min(budget, total) - used);
        if (w >= Math.max(15, o.minSession || 15)) { out.push({ l, watch: w, self: 0, rec: 0, partial: true, consolidate: false }); used += w; fresh++; }
        return out;
      } else return out;
    }
  }
  return out;
}

export function buildDay(snap: Snapshot, k: DateKey, o: DayOptions): DayResult {
  const P = o.prep, lectureMode = P.mode === 'lectures' && snap.lectures.some(l => !l.done);
  const id = o.id || ((p: string) => p + Math.random().toString(36).slice(2, 9));
  const keep = (o.keep || []).map(t => ({ ...t }));
  const keepTodo = keep.filter(t => t.status !== 'done' && t.status !== 'skipped');
  let B = Math.max(0, Math.round(o.minutes) - sum(keepTodo.map(t => t.min)));
  const notes: string[] = [];
  const nSub = o.subjectsPerDay > 0 ? (P.maxSwitches > 0 ? Math.min(o.subjectsPerDay, P.maxSwitches + 1) : o.subjectsPerDay) : (P.maxSwitches > 0 ? P.maxSwitches + 1 : 0);
  const pick = pickSubjects(snap, k, nSub, { lectureMode, daysLeft: o.daysLeft });
  const filter = nSub > 0 ? new Set(pick.ids) : null;
  const C = candidates(snap, k, { subjectFilter: filter, lectureMode });
  const total0 = B;
  const endK = endOf(k, snap.sh), startK = startOf(k, snap.sh);
  // question review
  const qDue = snap.questions.filter(q => q.mem && q.mem.due < endK)
    .sort((a, b) => (Number(b.recentWrong) - Number(a.recentWrong)) || ((a.mem!.due) - (b.mem!.due)));
  let qMin = 0;
  if (qDue.length && B >= 20) {
    const cap = f5(B * ({ early: 0.15, middle: 0.2, final: 0.3 }[o.mixKey]));
    qMin = Math.min(Math.max(10, r5(qDue.length * P.minPerQuestion)), Math.max(10, cap), B);
    B -= qMin;
  }
  // lectures: watch, then self-study, then recall
  let bundles: Bundle[] = [];
  if (lectureMode && B >= 15) {
    bundles = lectureBundles(snap, filter ? pick.ids : pick.ids.length ? pick.ids : null, B * o.mix.new, B, o);
    B -= sum(bundles.map(b => b.watch + b.self + b.rec));
  }
  // Subjects with no topics or concepts yet (and no lectures to follow) are planned as a whole: "Study <subject>".
  const bare = bareSubjects(snap, filter ? pick.ids : null, lectureMode);
  const bareBlocks: { sid: ID; min: number; part: number; parts: number; brk: boolean }[] = [];
  if (bare.length && B >= 15) {
    const scopeN = filter ? pick.ids.length : snap.subjects.filter(s => s.learnLeftMin > 0 || snap.concepts.some(c => c.sid === s.id)).length;
    const structured = Math.max(0, scopeN - bare.length);
    const keepForReview = Math.min(B * 0.4, r5(C.due.length * snap.minPerReview) + (C.mistakesDue.length ? 10 : 0));
    const share = structured > 0 ? (o.mix.new + o.mix.practice) * bare.length / Math.max(1, scopeN) : 1;
    let bm = Math.min(f5((B - (structured > 0 ? 0 : keepForReview)) * share), sum(bare.map(s => r5(s.learnLeftMin))));
    const minS = Math.max(15, o.minSession || 15);
    let use = bare.slice(0, Math.max(1, Math.floor(bm / minS)));
    if (bm >= minS) {
      const per = f5(bm / use.length); let rest = bm - per * use.length;
      for (const s of use) {
        let m = per + (rest >= 5 ? 5 : 0); if (rest >= 5) rest -= 5;
        m = Math.min(m, Math.max(minS, r5(s.learnLeftMin)));
        const parts = m > 90 ? Math.ceil(m / 75) : 1;
        for (let i = 0; i < parts; i++) bareBlocks.push({ sid: s.id, min: i < parts - 1 ? r5(m / parts) : m - r5(m / parts) * (parts - 1), part: i + 1, parts, brk: false });
      }
      // without study windows, a 5-minute break goes between long blocks; it comes out of the same time
      if (!o.windows.length) bareBlocks.forEach((x, i) => { if (i > 0 && bareBlocks[i - 1].min >= 45) { x.brk = true; const big = bareBlocks.slice().sort((a, b) => b.min - a.min)[0]; big.min -= 5; } });
      B -= sum(bareBlocks.map(x => x.min + (x.brk ? 5 : 0)));
    }
  }
  const lecMin = total0 - qMin - B;
  // the rest: planDay
  const wantNew = Math.max(0, o.mix.new * (B + lecMin) - lecMin);
  const mixRest = adaptMix(o.mix, B > 0 ? wantNew / B : 0);
  const p = B >= 5 ? planDay({ minutes: B, daysLeft: o.daysLeft, phase: o.mixKey, mix: { [o.mixKey]: mixRest }, minPerReview: snap.minPerReview,
    due: C.due, newCands: C.newCands, practiceCands: C.practiceCands, mistakesDue: C.mistakesDue, cumulativeCands: C.cumulativeCands,
    formulaCands: C.formulaCands, lastStudyGapDays: snap.lastStudyGapDays }) : { phase: o.mixKey, blocks: [], notes: [] as string[] };
  let blocks: DayTask[] = (p.blocks || []).map((b: any) => ({ ...b }));
  if (o.windows.length) {
    const brk = sum(blocks.filter(b => b.kind === 'break').map(b => b.min));
    blocks = blocks.filter(b => b.kind !== 'break');
    const big = blocks.filter(b => b.kind !== 'review').sort((a, b) => b.min - a.min)[0] || blocks[0];
    if (big && brk) big.min += brk;
  }
  notes.push(...(p.notes || []));
  // assemble
  const subjOfC: Record<ID, ID> = {}; snap.concepts.forEach(c => { subjOfC[c.id] = c.sid; });
  const oneSubject = (cids: ID[]) => { const s = [...new Set(cids.map(c => subjOfC[c]).filter(Boolean))]; return s.length === 1 ? s[0] : null; };
  const subjName = (sid: ID | null) => { const s = snap.subjects.find(x => x.id === sid); return s ? s.name : ''; };
  const tasks: DayTask[] = [];
  const add = (t: Partial<DayTask> & { kind: DayTask['kind']; min: number; title: string }) => tasks.push({ key: '', mids: [], cids: [], ...t } as DayTask);
  const pickWhy = (sid: ID | null) => sid && pick.why[sid] ? pick.why[sid].slice(0, 4) : [];
  for (const b of bundles) {
    const l = b.l, sw = pickWhy(l.sid);
    if (b.watch) add({ kind: 'lecture', min: b.watch, title: (b.partial ? 'Watch part of ' : 'Watch ') + l.label + (b.partial ? ` (${b.watch} of ${l.min || P.defaultLectureMin} min)` : ''),
      cids: l.cids, lectureId: l.id, subjectId: l.sid, why: [`next lecture in ${subjName(l.sid)}`, ...sw] });
    if (b.self) add({ kind: 'selfstudy', min: b.self, title: 'Self-study: ' + l.label, cids: l.cids, lectureId: l.id, subjectId: l.sid,
      why: b.consolidate ? [`${l.label} was watched; self-study turns it into understanding before the next lecture`] : ['work through the lecture material on your own while it is fresh'] });
    if (b.rec) add({ kind: l.cids.length ? 'review' : 'recall', min: b.rec, title: 'Recall ' + l.label + ' from memory', cids: l.cids, lectureId: l.id, subjectId: l.sid,
      why: ['recalling straight after studying strengthens what you just learned'] });
  }
  const bareKind: DayTask['kind'] = o.phase && (o.phase.key === 'practice' || o.phase.key === 'revision' || o.phase.key === 'final') ? 'practice' : 'new';
  bareBlocks.forEach((x, i) => {
    const name = subjName(x.sid);
    if (x.brk) add({ kind: 'break', min: 5, title: 'Short break', cids: [], subjectId: null, why: ['a short break keeps the next block effective'] });
    add({ kind: bareKind, min: x.min, title: (bareKind === 'practice' ? 'Practise ' : 'Study ') + name + (x.parts > 1 ? ` (part ${x.part} of ${x.parts})` : ''), cids: [], subjectId: x.sid,
      why: [`${name} has no topics or concepts yet, so its time is planned for the subject as a whole; add topics or import a syllabus for more specific tasks`, ...pickWhy(x.sid)] });
  });
  const dueN = C.due.length, overdue = C.due.filter(d => d.overdue).length, critical = C.due.filter(d => d.critical).length;
  for (const b of blocks) {
    const sid = b.kind === 'break' ? null : oneSubject(b.cids);
    const why: string[] = [];
    if (b.kind === 'review' && b.title !== 'Recall what you just learned' && b.title !== 'Micro recall') { why.push(plural(dueN, 'concept') + ' due for review'); if (overdue) why.push(overdue + ' overdue' + (critical ? `, ${critical} critical` : '')); }
    else if (b.kind === 'review' || b.title === 'Micro recall') why.push('recall keeps what you studied from fading');
    else if (b.kind === 'new') { why.push('next unstarted concepts in syllabus order, prerequisites first'); why.push(...pickWhy(sid)); }
    else if (b.kind === 'practice') { const notesP = C.practiceCands.filter(x => b.cids.includes(x.cid) && x.note).map(x => x.note); why.push(...(notesP.length ? notesP.slice(0, 2) : ['concepts you understand but have not yet applied enough'])); if (b.interleaved) why.push('mixed across subjects so you learn to tell problem types apart'); }
    else if (b.kind === 'mistakes') why.push(plural(b.mids.length, 'mistake') + ' due for a staged retry');
    else if (b.kind === 'cumulative') why.push('older concepts not recalled for 5 or more days, mixed across subjects');
    else if (b.kind === 'break') why.push('a short break keeps the next block effective');
    add({ ...b, subjectId: sid, why });
  }
  if (qMin) {
    const n = Math.max(1, Math.min(qDue.length, Math.floor(qMin / P.minPerQuestion)));
    const wrong = qDue.slice(0, n).filter(q => q.recentWrong).length;
    const q: Omit<DayTask, 'key'> = { kind: 'qreview', min: qMin, title: 'Re-solve ' + plural(n, 'saved question'), cids: [], mids: [], qids: qDue.slice(0, n).map(x => x.id),
      subjectId: oneSubjectQ(qDue.slice(0, n)), why: [plural(qDue.length, 'saved question') + ' due' + (qDue.filter(x => x.mem!.due < startK).length ? ', some overdue' : ''), ...(wrong ? [wrong + ' you got wrong recently'] : [])] };
    const at = tasks.map(t => t.kind).lastIndexOf('practice');
    tasks.splice(at >= 0 ? at + 1 : tasks.length, 0, { key: '', ...q } as DayTask);
  }
  if (o.recoveryDays) notes.unshift(`You missed ${plural(o.recoveryDays, 'planned study day')}. This plan clears the most urgent reviews first and keeps going with lectures and syllabus in order; the rest of the backlog is spread over the coming days instead of stacked on today.`);
  // keys and ids
  const used = new Set(keep.map(t => t.key));
  tasks.forEach((t, i) => { let key = t.kind + i; while (used.has(key)) key += 'x'; used.add(key); t.key = key; t.id = id('tk'); t.status = 'todo'; });
  const merged = keep.concat(tasks);
  const slotted = slotTasks(merged, o.windows, { fromMin: o.fromMin ?? null, minSession: o.minSession || 15, id });
  const unscheduledMin = o.windows.length ? sum(slotted.filter(t => !t.start && t.status === 'todo').map(t => t.min)) : 0;
  if (unscheduledMin) notes.push(`${unscheduledMin} min did not fit into your study windows today. They stay in the list without a time.`);
  return { date: k, tasks: slotted, notes, subjects: pick.ids.map(s => ({ id: s, why: pick.why[s] })), minutes: o.minutes,
    plannedMin: sum(slotted.filter(t => t.status !== 'skipped').map(t => t.min)), phase: o.mixKey, unscheduledMin };
}
/** Subjects in scope with learning left but no concepts (and, in lecture mode, no lectures still to follow), best first. */
export function bareSubjects(snap: Snapshot, scope: ID[] | null, lectureMode: boolean): PlanSubject[] {
  const withConcepts = new Set(snap.concepts.map(c => c.sid)), withLectures = new Set(snap.lectures.filter(l => !l.done).map(l => l.sid));
  const ids = scope || snap.subjects.slice().sort((a, b) => (b.priority - a.priority) || (b.imp - a.imp) || (a.order - b.order)).map(s => s.id);
  return ids.map(id => snap.subjects.find(s => s.id === id)).filter((s): s is PlanSubject => !!s && s.learnLeftMin > 0 && !withConcepts.has(s.id) && !(lectureMode && withLectures.has(s.id)));
}
function oneSubjectQ(qs: PlanQuestion[]) { const s = [...new Set(qs.map(q => q.sid).filter(Boolean))]; return s.length === 1 ? s[0] : null; }

/* ------------------------------------------------------------------ time windows */

const SPLITTABLE = new Set(['new', 'practice', 'selfstudy', 'lecture', 'cumulative']);
/**
 * Places tasks in the day's windows in order, with a 5-minute gap between tasks. Locked tasks keep their time.
 * A long task that does not fit is split across windows when both parts are at least a minimum session long;
 * anything that still does not fit keeps no time. For today, windows that have passed are skipped.
 */
export function slotTasks(tasks: DayTask[], windows: TimeWindow[], o: { fromMin?: number | null; minSession?: number; gap?: number; id?: (p: string) => string } = {}): DayTask[] {
  const out = tasks.map(t => ({ ...t }));
  if (!windows.length) { out.forEach(t => { if (!(t.locked && t.start)) { t.start = null; t.end = null; } }); return out; }
  const gap = o.gap ?? 5, minS = o.minSession || 15, from = o.fromMin ?? -1;
  type Iv = { a: number; b: number };
  let free: Iv[] = windows.map(w => ({ a: Math.max(clockToMin(w.start), from), b: clockToMin(w.end) })).filter(iv => iv.b - iv.a >= 5);
  const cut = (a: number, b: number) => { const nx: Iv[] = []; for (const iv of free) { if (b <= iv.a || a >= iv.b) nx.push(iv); else { if (a > iv.a) nx.push({ a: iv.a, b: a }); if (b < iv.b) nx.push({ a: b, b: iv.b }); } } free = nx.filter(iv => iv.b - iv.a >= 5); };
  for (const t of out) if ((t.locked && t.start) || (t.status !== 'todo' && t.start)) { const a = clockToMin(t.start as string); cut(a, a + t.min + gap); }
  const result: DayTask[] = [];
  for (const t of out) {
    if ((t.locked && t.start) || t.status !== 'todo') { result.push(t); continue; }
    const iv = free.find(x => x.b - x.a >= t.min);
    if (iv) { t.start = minToClock(iv.a); t.end = minToClock(iv.a + t.min); iv.a = Math.min(iv.b, iv.a + t.min + gap); free = free.filter(x => x.b - x.a >= 5); result.push(t); continue; }
    const big = free.slice().sort((x, y) => (y.b - y.a) - (x.b - x.a))[0];
    if (big && SPLITTABLE.has(t.kind) && big.b - big.a >= minS && t.min - (big.b - big.a) >= minS) {
      const first = f5(big.b - big.a);
      const a = { ...t, min: first, start: minToClock(big.a), end: minToClock(big.a + first) };
      const rest: DayTask = { ...t, key: t.key + 'b', id: o.id ? o.id('tk') : (t.id || '') + 'b', min: t.min - first, title: t.title + ' (continued)', start: null, end: null };
      big.a = Math.min(big.b, big.a + first + gap); free = free.filter(x => x.b - x.a >= 5);
      result.push(a);
      const iv2 = free.find(x => x.b - x.a >= rest.min);
      if (iv2) { rest.start = minToClock(iv2.a); rest.end = minToClock(iv2.a + rest.min); iv2.a = Math.min(iv2.b, iv2.a + rest.min + gap); free = free.filter(x => x.b - x.a >= 5); }
      result.push(rest); continue;
    }
    t.start = null; t.end = null; result.push(t);
  }
  return result.sort((x, y) => (x.start ? clockToMin(x.start) : 1e4) - (y.start ? clockToMin(y.start) : 1e4));
}

/* ------------------------------------------------------------------ projecting the coming days */

export function cloneSnapshot(s: Snapshot): Snapshot { return JSON.parse(JSON.stringify(s)); }
/** Advances the snapshot as if the day's tasks were done: concepts started, reviews answered Good, lectures and mistakes moved on. */
export function applyDay(snap: Snapshot, k: DateKey, tasks: DayTask[]): void {
  const t0 = startOf(k, snap.sh) + 18 * HOUR, byC: Record<ID, PlanConcept> = {}, byL: Record<ID, PlanLecture> = {}, byQ: Record<ID, PlanQuestion> = {};
  snap.concepts.forEach(c => { byC[c.id] = c; }); snap.lectures.forEach(l => { byL[l.id] = l; }); snap.questions.forEach(q => { byQ[q.id] = q; });
  const opts = { ...snap.memOpts, fuzz: false };
  const exp = snap.exposure[k] || (snap.exposure[k] = {});
  for (const t of tasks) {
    if (t.status === 'skipped' || t.kind === 'break') continue;
    const sids = new Set<ID>(); if (t.subjectId) sids.add(t.subjectId); t.cids.forEach(c => { if (byC[c]) sids.add(byC[c].sid); });
    sids.forEach(s => { exp[s] = (exp[s] || 0) + t.min / Math.max(1, sids.size); snap.lastStudied[s] = k; });
    if (t.kind === 'review' || t.kind === 'cumulative') t.cids.forEach(c => { const x = byC[c]; if (!x) return; x.mem = Memory.apply(x.mem && x.mem.S ? x.mem : null, 3, t0, opts).m; x.state = Math.max(x.state, 3); });
    if (t.kind === 'new' || t.kind === 'lecture' || t.kind === 'selfstudy') t.cids.forEach(c => { const x = byC[c]; if (!x) return; if (x.state < 1) x.state = 1; if (!x.mem) x.mem = { state: 'new', due: dayStart(addDays(k, 1), snap.sh), reps: 0, lapses: 0, ok: 0, fail: 0 }; });
    if (t.kind === 'practice') t.cids.forEach(c => { const x = byC[c]; if (x && x.state < 4) x.state = 4; });
    if ((t.kind === 'new' || t.kind === 'practice') && !t.cids.length && t.subjectId) { const s = snap.subjects.find(x => x.id === t.subjectId); if (s) s.learnLeftMin = Math.max(0, s.learnLeftMin - t.min); }
    if (t.lectureId && byL[t.lectureId]) {
      const l = byL[t.lectureId];
      if (t.kind === 'lecture' && !/^Watch part/.test(t.title)) { l.watched = true; l.watchedAt = t0; }
      if (t.kind === 'selfstudy') l.studied = true;
      if (t.kind === 'recall' || t.kind === 'review') l.recalled = true;
      l.done = l.watched && (l.studied || l.recalled);
    }
    if (t.kind === 'mistakes') for (const mid of t.mids) { const m = snap.mistakes.find(x => x.id === mid); if (m) { m.stage++; m.next = m.stage >= RETRY_DAYS.length ? Infinity : dayStart(addDays(k, RETRY_DAYS[m.stage]), snap.sh); } }
    if (t.kind === 'qreview') (t.qids || []).forEach(q => { const x = byQ[q]; if (x) { x.mem = Memory.apply(x.mem && x.mem.S ? x.mem : null, 3, t0, opts).m; x.recentWrong = false; } });
  }
  snap.mistakes = snap.mistakes.filter(m => isFinite(m.next));
  snap.subjects.forEach(s => { const cs = snap.concepts.filter(c => c.sid === s.id); if (cs.length) s.learnedFrac = cs.filter(c => c.state >= 1).length / cs.length; });
  snap.lastStudyGapDays = 0;
}
/** Plans `n` days from `from`. `dayOpts` gives each day's minutes, windows, phase and kept tasks. */
export function projectDays(snap0: Snapshot, from: DateKey, n: number, dayOpts: (k: DateKey) => DayOptions): DayResult[] {
  const snap = cloneSnapshot(snap0), out: DayResult[] = [];
  for (let i = 0; i < n; i++) {
    const k = addDays(from, i);
    if (i > 0) snap.now = startOf(k, snap.sh) + 8 * HOUR;
    const day = buildDay(snap, k, dayOpts(k));
    out.push(day);
    applyDay(snap, k, day.tasks.filter(t => t.status !== 'skipped'));
  }
  return out;
}

/* ------------------------------------------------------------------ missed days and recovery */

export type Missed = { days: DateKey[]; streak: number; plannedMin: number };
/** Planned study days (at least 15 minutes planned) in the last `lookback` days where under a fifth of the plan was studied. */
export function detectMissed(i: { today: DateKey; history: Record<DateKey, PlanHistoryEntry>; studiedMin: Record<DateKey, number>; av: StudyAvailability;
  since?: DateKey | null; lookback?: number }): Missed {
  const out: Missed = { days: [], streak: 0, plannedMin: 0 };
  let streakOpen = true;
  for (let d = 1; d <= (i.lookback || 14); d++) {
    const k = addDays(i.today, -d);
    if (i.since && k < i.since) break;
    const h = i.history[k];
    const planned = h ? h.plannedMin : minutesOn(k, i.av);
    if (planned < 15) continue;                         // rest days neither count nor break a streak
    const studied = i.studiedMin[k] || 0;
    if (studied < planned * 0.2) { out.days.push(k); out.plannedMin += planned; if (streakOpen) out.streak++; }
    else streakOpen = false;
  }
  return out;
}
export type Recovery = { backlogMin: number; weekCapacityMin: number; daysToClear: number; perDayCatchUp: number; realistic: boolean; lines: string[] };
/** How long the backlog takes to clear if at most ~40% of each coming day goes to catching up. */
export function recoveryPlan(i: { missed: Missed; overdueReviews: number; minPerReview: number; missedLectureMin: number; mistakesDue: number;
  questionsDue: number; minPerQuestion: number; nextDays: { k: DateKey; min: number }[]; learnGapMin?: number }): Recovery {
  const backlogMin = Math.round(i.overdueReviews * i.minPerReview + i.mistakesDue * 5 + i.questionsDue * i.minPerQuestion);
  const week = i.nextDays.slice(0, 7), weekCapacityMin = sum(week.map(d => d.min));
  let left = backlogMin, days = 0;
  for (const d of i.nextDays) { if (left <= 0) break; left -= d.min * 0.4; days++; }
  const perDay = week.filter(d => d.min > 0).length ? r5(Math.min(backlogMin, weekCapacityMin * 0.4) / week.filter(d => d.min > 0).length) : 0;
  const lines = [
    `Overdue: ${plural(i.overdueReviews, 'review')}, ${plural(i.mistakesDue, 'mistake retry', 'mistake retries')}, ${plural(i.questionsDue, 'saved question')}.`,
    i.missedLectureMin ? `Lectures planned on missed days (about ${Math.round(i.missedLectureMin)} min) simply continue in order; nothing is doubled up.` : '',
    backlogMin ? `Catching up takes about ${Math.round(backlogMin)} min. Spread at about ${perDay} min a day, it clears in ${plural(Math.max(1, days), 'day')} without pushing out new learning.` : 'No revision backlog built up.',
    i.learnGapMin && i.learnGapMin > 0 ? `The missed days also cost about ${Math.round(i.learnGapMin / 60)} hours of new learning. The roadmap shows what can still fit and what to deprioritise.` : ''
  ].filter(Boolean);
  return { backlogMin, weekCapacityMin, daysToClear: left > 0 ? -1 : days, perDayCatchUp: perDay, realistic: left <= 0, lines };
}

/* ------------------------------------------------------------------ regeneration */

/** Tasks a regeneration must keep: locked, edited by you, done or skipped. */
export function keepOnRegenerate(tasks: DayTask[], isDone: (t: DayTask) => boolean): DayTask[] {
  return tasks.filter(t => t.locked || t.manual || t.status === 'skipped' || t.status === 'done' || isDone(t))
    .map(t => ({ ...t, status: t.status === 'skipped' ? 'skipped' : (t.status === 'done' || isDone(t)) ? 'done' : 'todo' }));
}
