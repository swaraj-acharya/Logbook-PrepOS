/*
 * Lectures: a stable id, a position within the subject and an optional user title.
 * The visible code (L01, L02 …) is derived from the position, so inserting a lecture renumbers the codes
 * without touching ids or titles. Titles are never derived from ids.
 */
import { addDays, dayKey, daysBetween, weekStart, DAY } from './engine.js';
import type { DateKey, ID, Lecture, LectureStatus, RoadmapBaseline, SyllabusNode } from './types';

type IdFn = (prefix: string) => string;
const defaultId: IdFn = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const AUTO_CODE = /^L\d{1,4}$/i;

export function live(list: Lecture[]): Lecture[] { return list.filter(l => l && !l.gone); }
export function subjectLectures(list: Lecture[], subjectId: ID): Lecture[] {
  return live(list).filter(l => l.subjectId === subjectId).sort((a, b) => a.order - b.order);
}
export function codeFor(position: number, total: number): string {
  return 'L' + String(position).padStart(Math.max(2, String(Math.max(total, position)).length), '0');
}
/** Code and title for every lecture: { id: { code, pos, label } }. */
export function lectureLabels(list: Lecture[]): Record<ID, { code: string; pos: number; label: string; total: number }> {
  const out: Record<ID, { code: string; pos: number; label: string; total: number }> = {};
  const bySub: Record<ID, Lecture[]> = {};
  for (const l of live(list)) (bySub[l.subjectId] || (bySub[l.subjectId] = [])).push(l);
  for (const sid in bySub) {
    const arr = bySub[sid].sort((a, b) => a.order - b.order);
    arr.forEach((l, i) => {
      const code = codeFor(i + 1, arr.length);
      out[l.id] = { code, pos: i + 1, total: arr.length, label: l.name ? code + ' ' + l.name : code };
    });
  }
  return out;
}

export function generateLectures(subjectId: ID, count: number, opts: { min?: number; startOrder?: number; now?: number; id?: IdFn } = {}): Lecture[] {
  const n = Math.max(0, Math.min(2000, Math.floor(count || 0)));
  const now = opts.now ?? Date.now(), id = opts.id || defaultId, start = opts.startOrder ?? 0;
  return Array.from({ length: n }, (_, i) => ({
    id: id('lec'), subjectId, order: start + i, name: '', conceptIds: [], topicId: null,
    min: opts.min && opts.min > 0 ? Math.round(opts.min) : undefined, createdAt: now, updatedAt: now
  }));
}

function renumber(list: Lecture[], subjectId: ID, ordered: Lecture[], now: number): Lecture[] {
  const pos = new Map(ordered.map((l, i) => [l.id, i]));
  return list.map(l => (l.subjectId === subjectId && pos.has(l.id) && l.order !== pos.get(l.id))
    ? { ...l, order: pos.get(l.id) as number, updatedAt: now } : l);
}

/** Inserts a lecture after `afterId` (or at the start when null). Returns the new list and the new lecture. */
export function insertLecture(list: Lecture[], subjectId: ID, afterId: ID | null, fields: Partial<Lecture> = {}, opts: { now?: number; id?: IdFn } = {}): { lectures: Lecture[]; lecture: Lecture } {
  const now = opts.now ?? Date.now();
  const lecture: Lecture = { id: (opts.id || defaultId)('lec'), subjectId, order: 0, name: '', conceptIds: [], topicId: null, createdAt: now, updatedAt: now, ...fields };
  const ordered = subjectLectures(list, subjectId);
  const at = afterId == null ? 0 : ordered.findIndex(l => l.id === afterId) + 1;
  ordered.splice(at <= 0 && afterId != null ? ordered.length : at, 0, lecture);
  return { lectures: renumber(list.concat(lecture), subjectId, ordered, now), lecture: { ...lecture, order: ordered.indexOf(lecture) } };
}
export function appendLectures(list: Lecture[], subjectId: ID, count: number, opts: { min?: number; now?: number; id?: IdFn } = {}): Lecture[] {
  const start = subjectLectures(list, subjectId).length;
  return list.concat(generateLectures(subjectId, count, { ...opts, startOrder: start }));
}
export function moveLecture(list: Lecture[], id: ID, dir: number, now = Date.now()): Lecture[] {
  const l = list.find(x => x.id === id); if (!l) return list;
  const ordered = subjectLectures(list, l.subjectId), i = ordered.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return list;
  ordered.splice(i, 1); ordered.splice(j, 0, l);
  return renumber(list, l.subjectId, ordered, now);
}
/** Renames a lecture. Typing just a code like "L07" clears the title so the code stays automatic. */
export function renameLecture(list: Lecture[], id: ID, name: string, now = Date.now()): Lecture[] {
  const v = String(name || '').trim();
  return list.map(l => l.id === id ? { ...l, name: AUTO_CODE.test(v) ? '' : v, updatedAt: now } : l);
}
export function updateLecture(list: Lecture[], id: ID, patch: Partial<Lecture>, now = Date.now()): Lecture[] {
  return list.map(l => l.id === id ? { ...l, ...patch, id: l.id, subjectId: patch.subjectId || l.subjectId, updatedAt: now } : l);
}
/** Removes a lecture, leaving a tombstone so a copy on another device does not bring it back. */
export function removeLecture(list: Lecture[], id: ID, now = Date.now()): Lecture[] {
  const l = list.find(x => x.id === id); if (!l) return list;
  const rest = list.map(x => x.id === id ? { id, subjectId: x.subjectId, order: x.order, name: '', conceptIds: [], gone: true, updatedAt: now } as Lecture : x);
  return renumber(rest, l.subjectId, subjectLectures(rest, l.subjectId), now);
}

/* ------------------------------------------------------------------ progress: watch, self-study, recall, practice */

export type LectureStep = 'watch' | 'study' | 'recall' | 'practice';
export type LectureProgress = { watch: boolean; study: boolean; recall: boolean; practice: boolean;
  status: LectureStatus; covered: boolean; next: LectureStep | null; completedAt: number | null };
/**
 * A lecture counts as covered once it was watched and consolidated by self-study or recall, or when it is
 * marked complete by hand. Evidence can come from the lecture's concepts (a successful recall or practice
 * after the lecture was watched).
 */
export function lectureProgress(l: Lecture, evidence: { recalledAt?: number | null; practicedAt?: number | null } = {}): LectureProgress {
  const recalledAt = l.recalledAt || (evidence.recalledAt && l.watchedAt && evidence.recalledAt >= l.watchedAt ? evidence.recalledAt : null);
  const practicedAt = l.practicedAt || (evidence.practicedAt && l.watchedAt && evidence.practicedAt >= l.watchedAt ? evidence.practicedAt : null);
  const watch = !!l.watchedAt || !!l.doneAt, study = !!l.studiedAt, recall = !!recalledAt, practice = !!practicedAt;
  const covered = !!l.doneAt || (watch && (study || recall));
  const completedAt = l.doneAt || (covered ? Math.max(l.studiedAt || 0, recalledAt || 0, l.watchedAt || 0) || null : null);
  const status: LectureStatus = covered ? 'done' : (watch || study) ? 'in-progress' : 'todo';
  const next: LectureStep | null = !watch ? 'watch' : !study && !l.doneAt ? 'study' : !recall && !l.doneAt ? 'recall' : !practice && l.conceptIds.length ? 'practice' : null;
  return { watch, study, recall, practice, status, covered, next, completedAt };
}
export function markStep(l: Lecture, step: LectureStep | 'done', at: number, on = true): Lecture {
  const f = { watch: 'watchedAt', study: 'studiedAt', recall: 'recalledAt', practice: 'practicedAt', done: 'doneAt' }[step] as keyof Lecture;
  return { ...l, [f]: on ? (l[f] || at) : null, updatedAt: at };
}

export type LectureStats = { total: number; done: number; inProgress: number; remaining: number; pct: number;
  avgMin: number | null; remainingMin: number; doneThisWeek: number; perDay14: number;
  projectedEnd: DateKey | null; behindLectures: number; behindDays: number; expectedDone: number | null };
export function lectureStats(list: Lecture[], todayKey: DateKey, opts: { sh?: number; defaultMin?: number; baseline?: RoadmapBaseline | null;
  evidence?: (l: Lecture) => { recalledAt?: number | null; practicedAt?: number | null } } = {}): LectureStats {
  const ls = live(list), sh = opts.sh || 0;
  const prog = ls.map(l => ({ l, p: lectureProgress(l, opts.evidence ? opts.evidence(l) : {}) }));
  const done = prog.filter(x => x.p.covered), inProgress = prog.filter(x => x.p.status === 'in-progress');
  const withMin = ls.filter(l => l.min && l.min > 0);
  const avgMin = withMin.length ? withMin.reduce((a, l) => a + (l.min || 0), 0) / withMin.length : null;
  const dflt = avgMin || opts.defaultMin || 60;
  const remainingMin = prog.filter(x => !x.p.covered).reduce((a, x) => a + (x.l.min || dflt), 0);
  const ws = weekStart(todayKey), from14 = addDays(todayKey, -13);
  const kOf = (ts: number | null) => ts ? dayKey(ts, sh) : '';
  const doneThisWeek = done.filter(x => { const k = kOf(x.p.completedAt); return k >= ws && k <= todayKey; }).length;
  const d14 = done.filter(x => { const k = kOf(x.p.completedAt); return k >= from14 && k <= todayKey; }).length;
  const perDay14 = d14 / 14;
  const remaining = ls.length - done.length;
  const projectedEnd = remaining === 0 ? null : perDay14 > 0 ? addDays(todayKey, Math.ceil(remaining / perDay14)) : null;
  let behindLectures = 0, behindDays = 0, expectedDone: number | null = null;
  const base = opts.baseline && opts.baseline.lectures;
  if (base) {
    const planned = ls.filter(l => base[l.id]).map(l => base[l.id]).sort();
    if (planned.length) {
      expectedDone = planned.filter(k => k <= todayKey).length;
      const actual = done.filter(x => base[x.l.id]).length;
      behindLectures = Math.max(0, expectedDone - actual);
      const nextDue = planned[actual];
      if (behindLectures > 0 && nextDue && nextDue < todayKey) behindDays = daysBetween(nextDue, todayKey);
    }
  }
  return { total: ls.length, done: done.length, inProgress: inProgress.length, remaining, pct: ls.length ? done.length / ls.length : 0,
    avgMin, remainingMin, doneThisWeek, perDay14, projectedEnd, behindLectures, behindDays, expectedDone };
}

/* ------------------------------------------------------------------ concepts that stand for lectures */

/**
 * In a subject with no concepts of its own, each lecture gets a concept (under an automatic "Lectures" topic) so
 * recall, spaced review, practice links and mastery work for lectures without any extra setup. Names and order
 * follow the lectures. Subjects that already have their own concepts are left alone: map lectures to them instead.
 */
export function syncAutoConcepts(nodes: SyllabusNode[], lectures: Lecture[], subjectId: ID, opts: { now?: number; id?: IdFn; force?: boolean } = {}):
  { nodes: SyllabusNode[]; lectures: Lecture[]; created: number } {
  const now = opts.now ?? Date.now(), id = opts.id || defaultId;
  const ls = subjectLectures(lectures, subjectId);
  const kids: Record<string, SyllabusNode[]> = {};
  for (const n of nodes) (kids[n.parentId || '_'] || (kids[n.parentId || '_'] = [])).push(n);
  const under = (pid: ID): SyllabusNode[] => (kids[pid] || []).flatMap(k => [k, ...under(k.id)]);
  const all = under(subjectId);
  const ownConcepts = all.filter(n => n.kind === 'concept' && !n.lectureId);
  let topic = all.find(n => n.kind === 'topic' && n.auto === 'lectures');
  const needs = ls.filter(l => !l.conceptIds.length);
  if (!topic && (!needs.length || (ownConcepts.length && !opts.force))) return { nodes, lectures, created: 0 };
  let out = nodes.slice(), outL = lectures.slice(), created = 0;
  if (!topic) {
    const tSibs = (kids[subjectId] || []).filter(n => n.kind === 'topic');
    topic = { id: id('t'), kind: 'topic', parentId: subjectId, name: 'Lectures', order: tSibs.length ? Math.max(...tSibs.map(t => t.order || 0)) + 1 : 0, auto: 'lectures', createdAt: now };
    out.push(topic);
  }
  const labels = lectureLabels(lectures);
  const byLecture = new Map(out.filter(n => n.lectureId).map(n => [n.lectureId as ID, n]));
  if (!ownConcepts.length || opts.force) {
    for (const l of needs) {
      if (byLecture.has(l.id)) continue;
      const c: SyllabusNode = { id: id('c'), kind: 'concept', parentId: topic.id, name: labels[l.id] ? labels[l.id].label : 'Lecture', order: l.order, lectureId: l.id, createdAt: now };
      out.push(c); byLecture.set(l.id, c); created++;
      outL = outL.map(x => x.id === l.id ? { ...x, conceptIds: [c.id], topicId: topic!.id, updatedAt: now } : x);
    }
  }
  // Keep names and order in step with the lectures (renames and insertions renumber codes).
  const goneIds = new Set(lectures.filter(l => l.gone).map(l => l.id));
  out = out.map(n => {
    if (!n.lectureId || n.parentId !== topic!.id) return n;
    if (goneIds.has(n.lectureId)) return n.archived ? n : { ...n, archived: true };
    const lab = labels[n.lectureId]; if (!lab) return n;
    return (n.name !== lab.label || n.order !== lab.pos) ? { ...n, name: lab.label, order: lab.pos } : n;
  });
  return { nodes: out, lectures: outL, created };
}

/** The lectures that belong to a concept (a concept may be covered by several lectures). */
export function lecturesForConcept(list: Lecture[], cid: ID): Lecture[] { return live(list).filter(l => l.conceptIds.includes(cid)); }
export function lectureMinutes(l: Lecture, dflt: number): number { return l.min && l.min > 0 ? l.min : dflt; }
export const LECTURE_DAY = DAY;
