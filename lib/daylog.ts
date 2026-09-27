/**
 * The readable part of the progress file: an overview and one record per study day.
 *
 * Everything here is derived from the rest of the file (sessions, reviews, practice, questions, mistakes, lectures,
 * plans), recalculated on every save and ignored when the file is opened. Days are study days: activity after
 * midnight but before the "study day starts at" hour belongs to the previous day. Each day keeps its own record no
 * matter when it is saved or committed, and `scripts/progress-push.mjs` turns each day into its own git commit.
 */
import { dayKey, daysBetween, addDays } from './engine.js';
import { buildPhases, phaseOn } from './roadmap';
import { lectureLabels } from './lectures';
import type { DateKey, DayTask, ID, PrepWorkspace, SyllabusNode } from './types';

const KIND: Record<string, string> = { review: 'Review', new: 'New learning', practice: 'Practice', mistakes: 'Mistakes', cumulative: 'Cumulative recall', break: 'Break',
  lecture: 'Lecture', selfstudy: 'Self-study', recall: 'Recall', qreview: 'Question review' };
const MODE: Record<string, string> = { lecture: 'Lecture or video', reading: 'Reading', notes: 'Note-making', recall: 'Recall', practice: 'Problem solving', revision: 'Revision',
  mistakes: 'Mistake review', teachback: 'Teach-back', mock: 'Mock test', mixed: 'Mixed' };
const GRADE = ['', 'Again', 'Hard', 'Good', 'Easy'];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ts: number) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
/** ISO 8601 in local time with the UTC offset, e.g. 2026-09-27T21:14:00+05:30 (what git accepts as a commit date). */
export function isoLocal(ts: number): string {
  const d = new Date(ts), off = -d.getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const cut = (s: unknown, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
export function fmtMin(min: number): string {
  const m = Math.round(Math.max(0, min)), h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h}h ${pad(r)}m` : h ? `${h}h` : `${r}m`;
}
/** Drops empty values so each day reads cleanly. */
function tidy<T extends Record<string, any>>(o: T): T {
  for (const k of Object.keys(o)) { const v = o[k]; if (v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) delete o[k]; }
  return o;
}

export type DayTaskLog = { time?: string; title: string; kind: string; subject?: string; lecture?: string; minutes: number;
  status: 'done' | 'skipped' | 'to do' | 'not done'; progressMin?: number; locked?: boolean; addedOrEditedByYou?: boolean; movedFrom?: DateKey; why?: string[] };
export type DayLog = {
  date: DateKey; weekday: string; summary: string;
  exam?: { name: string; daysLeft?: number; phase?: string };
  time: { studiedMin: number; studied: string; sessions: number; plannedMin?: number; availableMin?: number; bySubject?: Record<string, number> };
  tasks?: DayTaskLog[]; planNotes?: string[];
  sessions?: Record<string, any>[];
  newConcepts?: string[];
  recall?: { count: number; remembered: number; items: { concept: string; subject?: string; grade: string; outcome?: string }[] };
  questions?: { attempted: number; correct: number; partial: number; wrong: number; logged: number; attempts: Record<string, any>[] };
  practiceCounts?: { concept: string; questions: number; correct: number; level?: string }[];
  lectures?: { lecture: string; subject?: string; steps: string[] }[];
  mistakes?: { logged: Record<string, any>[]; retries: Record<string, any>[]; resolved: number };
  teachBacks?: { concept: string; score?: number }[];
  firstActivityAt?: string; lastActivityAt?: string;
};
export type Overview = {
  about: string; generatedAt: string; today: DateKey;
  exam: { name: string; date?: string; daysLeft?: number } | null;
  totals: { studied: string; studiedMin: number; studyDays: number; sessions: number; currentStreakDays: number;
    concepts: number; conceptsRecalled: number; lectures: number; lecturesCovered: number;
    questionsSaved: number; questionAttempts: number; questionAccuracy: number | null; recalls: number; openMistakes: number };
  firstDay: DateKey | null; lastActivityAt: string | null; days: number;
};

/** Returns the workspace with `overview` and `days` added (both derived; see the file comment). */
export function withDayLog<T extends PrepWorkspace>(ws: T, now = Date.now()): T & { overview: Overview; days: Record<DateKey, DayLog> } {
  const { overview, days } = buildDayLog(ws, now);
  // overview near the top, the day records at the end (new days append, which keeps git diffs small)
  const out: any = {}, head = ['schemaVersion', 'app', 'workspaceId', 'createdAt', 'savedAt', 'updatedAt'];
  for (const k of head) if (k in ws) out[k] = (ws as any)[k];
  out.overview = overview;
  for (const k of Object.keys(ws)) if (!(k in out) && k !== 'overview' && k !== 'days') out[k] = (ws as any)[k];
  out.days = days;
  return out;
}

export function buildDayLog(ws: PrepWorkspace, now = Date.now()): { overview: Overview; days: Record<DateKey, DayLog> } {
  const sh = Number((ws.settings as any)?.dayStartHour ?? 4) || 0;
  const today = dayKey(now, sh), K = (ts: number) => dayKey(ts, sh);
  const byId: Record<ID, SyllabusNode> = {}; (ws.nodes || []).forEach(n => { byId[n.id] = n; });
  const subjectOf = (id: ID | null | undefined): SyllabusNode | null => { let n = id ? byId[id] : undefined, g = 0; while (n && n.kind !== 'subject' && g++ < 8) n = n.parentId ? byId[n.parentId] : undefined; return n && n.kind === 'subject' ? n : null; };
  const nameOf = (id: ID | null | undefined) => (id && byId[id] ? byId[id].name : '');
  const labels = lectureLabels(ws.lectures || []), lecById: Record<ID, any> = {}; (ws.lectures || []).forEach(l => { lecById[l.id] = l; });
  const lecName = (id: ID | null | undefined) => (id && labels[id] ? labels[id].label : '');
  const qById: Record<ID, any> = {}; (ws.practiceQuestions || []).forEach(q => { qById[q.id] = q; });
  const qSubject = (q: any) => q ? (q.subjectId ? nameOf(q.subjectId) : subjectOf(q.conceptId)?.name || '') : '';
  const ex = ws.exam, phases = ex && ex.date ? buildPhases(ex.startDate && ex.startDate < ex.date ? ex.startDate : firstDate(ws, K) || today, ex.date) : [];

  const days: Record<DateKey, DayLog & { _ts: number[] }> = {};
  const day = (k: DateKey) => days[k] || (days[k] = { date: k, weekday: WEEKDAY[new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)).getDay()], summary: '',
    time: { studiedMin: 0, studied: '0m', sessions: 0 }, _ts: [] } as any);
  const touch = (k: DateKey, ts: number) => { if (k <= today) day(k)._ts.push(ts); };

  // task titles by plan key, so sessions can say which task they were for
  const taskTitle: Record<DateKey, Record<string, string>> = {};
  for (const src of [ws.planHistory || {}, ws.plans || {}] as any[]) for (const k in src) {
    const list = src[k] && (src[k].blocks || src[k].tasks); if (!Array.isArray(list)) continue;
    for (const t of list) if (t && t.key && t.title) (taskTitle[k] || (taskTitle[k] = {}))[t.key] = t.title;
  }
  // sessions and time per subject
  const firstSeen: Record<ID, DateKey> = {};
  const live = (ws.sessions || []).filter(s => s && s.status !== 'discarded').sort((a, b) => a.startedAt - b.startedAt);
  for (const s of live) {
    const k = K(s.startedAt); if (k > today) continue;
    const d = day(k); touch(k, s.endedAt || s.startedAt);
    const min = (s.focusSec || 0) / 60; d.time.studiedMin += min; d.time.sessions++;
    const parts = Array.isArray(s.split) && s.split.length ? s.split : [{ s: s.subjectId, sec: s.focusSec || 0 }];
    for (const p of parts) { const nm = p.s ? nameOf(p.s) || 'Removed subject' : 'Mixed or no subject'; const b = d.time.bySubject || (d.time.bySubject = {}); b[nm] = (b[nm] || 0) + (p.sec || 0) / 60; }
    (s.conceptIds || []).forEach(c => { if (!firstSeen[c]) { firstSeen[c] = k; if (byId[c]) (d.newConcepts || (d.newConcepts = [])).push(byId[c].name); } });
    (d.sessions || (d.sessions = [])).push(tidy({ time: clock(s.startedAt) + '-' + clock(s.endedAt), focusMin: r1(min), pausedMin: s.pausedSec ? r1(s.pausedSec / 60) : null,
      subject: s.subjectId ? nameOf(s.subjectId) : 'Mixed', topic: nameOf(s.topicId), subtopic: nameOf(s.subtopicId),
      concepts: (s.conceptIds || []).map(nameOf).filter(Boolean), mode: MODE[s.mode] || s.mode, timer: s.timerStyle || null,
      source: s.source && s.source !== 'timer' ? s.source : null, edited: s.edited || null, lecture: lecName(s.lectureId), task: s.planBlock ? (taskTitle[k] && taskTitle[k][s.planBlock]) || s.planBlock : null,
      questions: s.questionsSolved || null, correct: s.questionsSolved ? s.questionsCorrect || 0 : null,
      confidenceBefore: s.confidenceBefore || null, confidenceAfter: s.confidenceAfter || null, focus: s.focusRating || null,
      understood: cut(s.understood, 300), difficult: cut(s.difficult, 300), notes: cut(s.notes, 400), status: s.status === 'completed' ? null : s.status }));
  }
  // recall
  for (const r of ws.reviews || []) {
    const k = K(r.at); if (k > today) continue; const d = day(k); touch(k, r.at);
    const x = d.recall || (d.recall = { count: 0, remembered: 0, items: [] }); x.count++; if (r.g >= 2) x.remembered++;
    x.items.push(tidy({ concept: nameOf(r.cid) || 'Removed concept', subject: subjectOf(r.cid)?.name, grade: GRADE[r.g] || String(r.g), outcome: r.o }));
  }
  // questions and practice counts
  for (const q of ws.practiceQuestions || []) { const k = K(q.createdAt); if (k > today) continue; const d = day(k); touch(k, q.createdAt); (d.questions || (d.questions = emptyQ())).logged++; }
  for (const a of ws.questionAttempts || []) {
    const k = K(a.at); if (k > today) continue; const d = day(k); touch(k, a.at);
    const x = d.questions || (d.questions = emptyQ()), q = qById[a.qid];
    x.attempted++; if (a.result === 'correct') x.correct++; else if (a.result === 'partial') x.partial++; else x.wrong++;
    x.attempts.push(tidy({ time: clock(a.at), question: q ? cut(q.text) : 'Removed question', subject: qSubject(q), concept: q ? nameOf(q.conceptId) : '',
      source: q && q.source ? cut(q.source + (q.ref ? ' ' + q.ref : ''), 80) : '', result: a.result, timeSec: a.timeSec || null, confidence: a.confidence || null, how: a.mode }));
  }
  for (const p of ws.practiceAttempts || []) {
    if (p.qid) continue;                          // already listed under questions
    const k = K(p.at); if (k > today) continue; const d = day(k); touch(k, p.at);
    (d.practiceCounts || (d.practiceCounts = [])).push(tidy({ concept: nameOf(p.cid) || 'Removed concept', questions: p.n, correct: r1(p.c), level: p.lv }));
  }
  // lectures
  const STEP: [string, string][] = [['watchedAt', 'watched'], ['studiedAt', 'self-study done'], ['recalledAt', 'recalled'], ['practicedAt', 'practised'], ['doneAt', 'marked complete']];
  for (const l of ws.lectures || []) {
    const by: Record<DateKey, string[]> = {};
    for (const [f, label] of STEP) { const t = (l as any)[f]; if (t) { const k = K(t); if (k <= today) { (by[k] || (by[k] = [])).push(label); touch(k, t); } } }
    for (const k in by) (day(k).lectures || (day(k).lectures = [])).push(tidy({ lecture: lecName(l.id) || l.name || 'Lecture', subject: nameOf(l.subjectId), steps: by[k] }));
  }
  // mistakes
  for (const m of ws.mistakes || []) {
    const k = K(m.at);
    if (k <= today) { const d = day(k); touch(k, m.at); (d.mistakes || (d.mistakes = { logged: [], retries: [], resolved: 0 })).logged.push(tidy({ question: cut(m.q), type: m.type, concept: nameOf(m.cid), subject: m.sid ? nameOf(m.sid) : subjectOf(m.cid)?.name, why: cut(m.why, 200) })); }
    for (const t of m.attempts || []) { const k2 = K(t.at); if (k2 > today) continue; const d = day(k2); touch(k2, t.at); (d.mistakes || (d.mistakes = { logged: [], retries: [], resolved: 0 })).retries.push({ question: cut(m.q, 100), result: t.r }); }
    if (m.resolved && m.resolvedAt) { const k3 = K(m.resolvedAt); if (k3 <= today) (day(k3).mistakes || (day(k3).mistakes = { logged: [], retries: [], resolved: 0 })).resolved++; }
  }
  for (const t of ws.teachBacks || []) { const k = K(t.at); if (k > today) continue; const d = day(k); touch(k, t.at); (d.teachBacks || (d.teachBacks = [])).push(tidy({ concept: nameOf(t.cid), score: t.score })); }

  // plans: the saved plan of each day, or the summary kept when the day ended
  const plans = ws.plans || {}, hist = ws.planHistory || {};
  const planDates = new Set([...Object.keys(plans), ...Object.keys(hist)].filter(k => k <= today));
  for (const k of planDates) {
    const p: any = plans[k], h: any = hist[k], d = day(k);
    let tasks: DayTaskLog[] = [];
    if (p && Array.isArray(p.blocks)) {
      tasks = p.blocks.filter((b: DayTask) => b.kind !== 'break').map((b: DayTask) => taskLog(b, statusIn(p, b, k, today), p.progress && p.progress[b.key]));
      if (p.avail != null) d.time.availableMin = p.avail;
      if (Array.isArray(p.notes) && p.notes.length) d.planNotes = p.notes.slice(0, 6);
    } else if (h && Array.isArray(h.tasks)) {
      tasks = h.tasks.filter((t: any) => t.kind !== 'break').map((t: any) => taskLog(t, t.status === 'done' ? 'done' : t.status === 'skipped' ? 'skipped' : k < today ? 'not done' : 'to do', null));
    }
    if (tasks.length) { d.tasks = tasks; d.time.plannedMin = tasks.filter(t => t.status !== 'skipped').reduce((a, t) => a + t.minutes, 0); }
  }
  function taskLog(b: any, status: DayTaskLog['status'], prog: number | null | undefined): DayTaskLog {
    const lec = lecName(b.lectureId);
    return tidy({ time: b.start ? b.start + (b.end ? '-' + b.end : '') : '', title: b.title || KIND[b.kind] || b.kind, kind: KIND[b.kind] || b.kind,
      subject: b.subjectId ? nameOf(b.subjectId) : '', lecture: lec && !(b.title || '').includes(lec) ? lec : '', minutes: b.min || 0, status,
      progressMin: prog && status !== 'done' ? Math.round(prog) : null, locked: b.locked || null, addedOrEditedByYou: b.manual || null, movedFrom: b.fromDay || null,
      why: Array.isArray(b.why) && b.why.length ? b.why.slice(0, 4) : null }) as DayTaskLog;
  }

  // finish each day: rounding, exam context, summary, activity times
  const out: Record<DateKey, DayLog> = {};
  for (const k of Object.keys(days).sort()) {
    const d = days[k];
    d.time.studiedMin = r1(d.time.studiedMin); d.time.studied = fmtMin(d.time.studiedMin);
    if (d.time.bySubject) { const b: Record<string, number> = {}; Object.entries(d.time.bySubject).sort((a, b2) => b2[1] - a[1]).forEach(([n, v]) => { b[n] = r1(v); }); d.time.bySubject = b; }
    if (ex) { const ph = phaseOn(phases, k); d.exam = tidy({ name: ex.name, daysLeft: ex.date ? daysBetween(k, ex.date) : null, phase: ph ? ph.name : null }) as any; }
    if (d._ts.length) { d.firstActivityAt = isoLocal(Math.min(...d._ts)); d.lastActivityAt = isoLocal(Math.max(...d._ts)); }
    d.summary = summaryOf(d);
    const { _ts, ...rest } = d;
    out[k] = orderKeys(rest);
  }
  return { overview: overviewOf(ws, out, now, today, K), days: out };
}

function emptyQ() { return { attempted: 0, correct: 0, partial: 0, wrong: 0, logged: 0, attempts: [] as Record<string, any>[] }; }
function statusIn(p: any, b: DayTask, k: DateKey, today: DateKey): DayTaskLog['status'] {
  if (b.status === 'skipped') return 'skipped';
  if (b.status === 'done' || (p.done && p.done[b.key]) || ((p.progress && p.progress[b.key]) || 0) >= b.min * 0.8) return 'done';
  return k < today ? 'not done' : 'to do';
}
function firstDate(ws: PrepWorkspace, K: (t: number) => DateKey): DateKey | null {
  const ts = (ws.sessions || []).map(s => s.startedAt).filter(Boolean);
  return ts.length ? K(Math.min(...ts)) : null;
}
function summaryOf(d: DayLog): string {
  const parts: string[] = [];
  if (d.time.sessions) {
    const subj = d.time.bySubject ? Object.entries(d.time.bySubject).slice(0, 4).map(([n, m]) => `${n} ${fmtMin(m)}`).join(', ') : '';
    parts.push(`Studied ${fmtMin(d.time.studiedMin)} in ${d.time.sessions} session${d.time.sessions > 1 ? 's' : ''}${subj ? ` (${subj})` : ''}.`);
  } else parts.push('No study sessions.');
  if (d.tasks) { const n = d.tasks.length, done = d.tasks.filter(t => t.status === 'done').length, sk = d.tasks.filter(t => t.status === 'skipped').length; parts.push(`Tasks: ${done} of ${n} done${sk ? `, ${sk} skipped` : ''}.`); }
  if (d.newConcepts) parts.push(`New concepts: ${d.newConcepts.length}.`);
  if (d.recall) parts.push(`Recall: ${d.recall.count} (${d.recall.remembered} remembered).`);
  if (d.questions && (d.questions.attempted || d.questions.logged)) parts.push(`Questions: ${d.questions.attempted} attempted, ${d.questions.correct} correct${d.questions.logged ? `, ${d.questions.logged} saved` : ''}.`);
  if (d.lectures) parts.push(`Lectures: ${d.lectures.map(l => `${l.lecture} ${l.steps.join(' and ')}`).join('; ')}.`);
  if (d.mistakes) parts.push(`Mistakes: ${d.mistakes.logged.length} logged, ${d.mistakes.retries.length} retried, ${d.mistakes.resolved} resolved.`);
  return parts.join(' ');
}
const ORDER = ['date', 'weekday', 'summary', 'exam', 'time', 'tasks', 'planNotes', 'sessions', 'newConcepts', 'recall', 'questions', 'practiceCounts', 'lectures', 'mistakes', 'teachBacks', 'firstActivityAt', 'lastActivityAt'];
function orderKeys(d: any): DayLog { const o: any = {}; for (const k of ORDER) if (d[k] !== undefined) o[k] = d[k]; for (const k in d) if (!(k in o)) o[k] = d[k]; return o; }

function overviewOf(ws: PrepWorkspace, days: Record<DateKey, DayLog>, now: number, today: DateKey, K: (t: number) => DateKey): Overview {
  const keys = Object.keys(days).sort(), studyDays = keys.filter(k => days[k].time.studiedMin > 0);
  let streak = 0; for (let k = today; ; k = addDays(k, -1)) { if (days[k] && days[k].time.studiedMin > 0) streak++; else if (k !== today) break; if (streak > 3650) break; }
  const concepts = (ws.nodes || []).filter(n => n.kind === 'concept' && !n.archived), recalled = new Set((ws.reviews || []).filter(r => r.g >= 2).map(r => r.cid));
  const lecs = ws.lectures || [], covered = lecs.filter((l: any) => l.doneAt || (l.watchedAt && (l.studiedAt || l.recalledAt)));
  const qa = ws.questionAttempts || [], correct = qa.filter(a => a.result === 'correct').length + qa.filter(a => a.result === 'partial').length * 0.5;
  const totalMin = r1(keys.reduce((a, k) => a + days[k].time.studiedMin, 0));
  const last = keys.map(k => days[k].lastActivityAt).filter(Boolean).sort().pop() || null;
  const ex = ws.exam;
  return {
    about: 'Readable summary. "days" has one record per study day with the tasks, sessions, recall, questions, lectures and mistakes of that day. Both are recalculated from the data below on every save and ignored when the file is opened, so edit your data in the app, not here.',
    generatedAt: isoLocal(now), today,
    exam: ex ? tidy({ name: ex.name, date: ex.date, daysLeft: ex.date ? daysBetween(today, ex.date) : null }) as any : null,
    totals: { studied: fmtMin(totalMin), studiedMin: totalMin, studyDays: studyDays.length, sessions: keys.reduce((a, k) => a + days[k].time.sessions, 0), currentStreakDays: streak,
      concepts: concepts.length, conceptsRecalled: concepts.filter(c => recalled.has(c.id)).length, lectures: lecs.length, lecturesCovered: covered.length,
      questionsSaved: (ws.practiceQuestions || []).length, questionAttempts: qa.length, questionAccuracy: qa.length ? Math.round(correct / qa.length * 100) / 100 : null,
      recalls: (ws.reviews || []).length, openMistakes: (ws.mistakes || []).filter(m => !m.resolved).length },
    firstDay: keys[0] || null, lastActivityAt: last, days: keys.length
  };
}
