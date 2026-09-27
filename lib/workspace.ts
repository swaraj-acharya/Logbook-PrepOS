/*
 * The preparation file: one portable, versioned JSON document that holds everything.
 *
 * Inside the app, data lives in small documents (core, ses-YYYY-MM, rev-YYYY-MM, mis-, tb-, qs-, pr-<subject>) that
 * can be saved and merged cheaply. docsToWorkspace/workspaceToDocs convert between that form and the file, and
 * parseWorkspaceText reads any file the app has ever produced:
 *   schema 2 preparation files, v1 "Export full backup" files, a bare core.json, or a set of v1 data files.
 * Nothing is dropped silently: items that cannot be used are kept in `quarantine` with the reason.
 */
import { monthKeyOf } from './engine.js';
import { isDateKey } from './dates';
import { SCHEMA_VERSION } from './types';
import type { CoreDoc, DailyPlan, Exam, ID, Lecture, MemoryRecord, PrepConfig, PrepWorkspace, Resource,
  StudyAvailability, SyllabusNode } from './types';

export const APP_NAME = 'Logbook PrepOS';
export { SCHEMA_VERSION };
export type Docs = Record<string, any>;
export type WorkspaceSource = 'v2' | 'v1-backup' | 'v1-core' | 'v1-docs' | 'data-files';
export class WorkspaceError extends Error {
  constructor(message: string, public code: 'invalid-json' | 'not-workspace' | 'unsupported-version' | 'invalid') { super(message); }
}
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const stampOf = (x: any) => (x && (x.updatedAt || x.at || x.createdAt || x.startedAt)) || 0;
const newId = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ------------------------------------------------------------------ defaults and core migration */

export function defaultPrep(): PrepConfig {
  return { mode: 'self', subjectsPerDay: { weekday: 0, weekend: 0 }, maxSwitches: 0, selfStudyRatio: 0.6, defaultLectureMin: 60,
    minPerNewConcept: 30, practiceMinPerConcept: 20, minPerQuestion: 5, defaultSubjectHours: 40, practiceScale: 1,
    dropLowImportance: false, effort: 'normal', extraMinPerDay: 0, acceptIncomplete: false, setupDone: false };
}
export function defaultAvailability(minutes = 120): StudyAvailability {
  const m = Math.max(0, Math.round(minutes || 0));
  return { weekday: { minutes: m, windows: [] }, weekend: { minutes: m, windows: [] }, weekendDays: [0, 6], restDays: [], unavailable: [],
    overrides: {}, sessionsPerDay: 0, minSession: 20 };
}
function num(v: unknown, d: number, lo = -Infinity, hi = Infinity) { const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; }
function normPrep(p: any): PrepConfig {
  const d = defaultPrep(), o = isObj(p) ? p : {};
  const spd = isObj(o.subjectsPerDay) ? o.subjectsPerDay : {};
  return { ...d, ...o,
    mode: o.mode === 'lectures' ? 'lectures' : 'self',
    subjectsPerDay: { weekday: num(spd.weekday, 0, 0, 12), weekend: num(spd.weekend, 0, 0, 12) },
    maxSwitches: num(o.maxSwitches, 0, 0, 20), selfStudyRatio: num(o.selfStudyRatio, d.selfStudyRatio, 0, 3),
    defaultLectureMin: num(o.defaultLectureMin, d.defaultLectureMin, 5, 600), minPerNewConcept: num(o.minPerNewConcept, d.minPerNewConcept, 5, 600),
    practiceMinPerConcept: num(o.practiceMinPerConcept, d.practiceMinPerConcept, 0, 600), minPerQuestion: num(o.minPerQuestion, d.minPerQuestion, 1, 120),
    defaultSubjectHours: num(o.defaultSubjectHours, d.defaultSubjectHours, 1, 2000), practiceScale: num(o.practiceScale, 1, 0, 2),
    dropLowImportance: !!o.dropLowImportance, effort: o.effort === 'extra' ? 'extra' : 'normal', extraMinPerDay: num(o.extraMinPerDay, 0, 0, 900),
    setupDone: !!o.setupDone };
}
function normDayAvail(x: any, fallback: number) {
  const o = isObj(x) ? x : {};
  const windows = Array.isArray(o.windows) ? o.windows.filter((w: any) => isObj(w) && /^\d\d:\d\d$/.test(w.start) && /^\d\d:\d\d$/.test(w.end) && w.end > w.start) : [];
  return { minutes: num(o.minutes, fallback, 0, 24 * 60), windows };
}
export function normAvailability(a: any, fallbackMin = 120): StudyAvailability {
  const d = defaultAvailability(fallbackMin), o = isObj(a) ? a : {};
  const days = (v: unknown, dflt: number[]) => Array.isArray(v) ? [...new Set(v.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))] : dflt;
  const overrides: Record<string, number> = {};
  if (isObj(o.overrides)) for (const k in o.overrides) if (isDateKey(k)) overrides[k] = num(o.overrides[k], 0, 0, 24 * 60);
  return { weekday: normDayAvail(o.weekday, d.weekday.minutes), weekend: normDayAvail(o.weekend, d.weekend.minutes),
    weekendDays: days(o.weekendDays, d.weekendDays), restDays: days(o.restDays, []),
    unavailable: Array.isArray(o.unavailable) ? [...new Set(o.unavailable.filter(isDateKey))].sort() : [],
    overrides, sessionsPerDay: num(o.sessionsPerDay, 0, 0, 12), minSession: num(o.minSession, 20, 5, 240) };
}

/** Brings a core document of any version to v2 in place. Safe to run repeatedly. Returns warnings for the user. */
export function migrateCore(core: any, now = Date.now()): { core: CoreDoc; changed: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const c = isObj(core) ? core : {};
  const before = JSON.stringify(c);
  const S = isObj(c.settings) ? c.settings : (c.settings = {});
  for (const k of ['exams', 'nodes', 'lectures', 'resources']) if (!Array.isArray(c[k])) c[k] = [];
  for (const k of ['mem', 'qmem', 'dayPlans', 'planHistory']) if (!isObj(c[k])) c[k] = {};
  if (!c.wsid) c.wsid = newId('ws');
  if (!('active' in c)) c.active = null;
  if (!('plan' in c)) c.plan = null;
  if (!('roadmap' in c)) c.roadmap = null;
  const hadPrep = isObj(c.prep);
  c.prep = normPrep(c.prep);
  if (!hadPrep) c.prep.setupDone = c.nodes.some((n: any) => n && n.kind === 'subject');
  c.availability = normAvailability(c.availability, num(S.avail, num(S.dailyMin, 120)));
  for (const e of c.exams as Exam[]) {
    if (!e || typeof e !== 'object') continue;
    if (e.date && !isDateKey(e.date)) { warnings.push('The date of exam "' + (e.name || 'untitled') + '" was not a valid date and was cleared.'); delete e.date; }
    if (e.startDate && !isDateKey(e.startDate)) delete e.startDate;
  }
  for (const l of c.lectures as Lecture[]) if (l && !Array.isArray(l.conceptIds)) l.conceptIds = [];
  c.createdAt = c.createdAt || now; c.updatedAt = c.updatedAt || 0;
  c.v = 2;
  return { core: c as CoreDoc, changed: JSON.stringify(c) !== before, warnings };
}
export function newCore(settings: Record<string, any>, now = Date.now()): CoreDoc {
  return migrateCore({ v: 2, settings, exams: [], nodes: [], mem: {}, qmem: {}, active: null, plan: null, createdAt: now, updatedAt: 0 }, now).core;
}

/* ------------------------------------------------------------------ docs -> workspace */

function subjectOfConcepts(nodes: SyllabusNode[]): Record<ID, ID> {
  const byId: Record<ID, SyllabusNode> = {}; nodes.forEach(n => { if (n && n.id) byId[n.id] = n; });
  const out: Record<ID, ID> = {};
  for (const n of nodes) { let p: SyllabusNode | undefined = n, g = 0; while (p && p.kind !== 'subject' && g++ < 8) p = p.parentId ? byId[p.parentId] : undefined; if (p && p.kind === 'subject') out[n.id] = p.id; }
  return out;
}
const iso = (t: number) => new Date(t || Date.now()).toISOString();

export function docsToWorkspace(docs: Docs, opts: { now?: number } = {}): PrepWorkspace {
  const now = opts.now ?? Date.now();
  const core = migrateCore(clone(docs.core || {}), now).core;
  const active = core.exams.find(e => e.id === core.settings.activeExamId) || core.exams.find(e => !e.archived) || null;
  const plans: Record<string, DailyPlan> = { ...(core.dayPlans || {}) };
  if (core.plan && core.plan.date) plans[core.plan.date] = core.plan;
  const ws: PrepWorkspace & { currentPlan?: string | null } = {
    schemaVersion: SCHEMA_VERSION, app: { name: APP_NAME, format: 'prep-workspace', savedWith: 'logbook-prepos' }, workspaceId: core.wsid,
    createdAt: iso(core.createdAt), savedAt: iso(now), updatedAt: core.updatedAt || 0,
    exam: active, exams: core.exams, subjects: core.nodes.filter(n => n && n.kind === 'subject'), nodes: core.nodes,
    lectures: [], resources: [], prep: core.prep, availability: core.availability, roadmap: core.roadmap || null,
    plans, planHistory: core.planHistory || {}, sessions: [], reviews: [], practiceAttempts: [], practiceQuestions: [], questionAttempts: [],
    mistakes: [], teachBacks: [], recallPrompts: {}, conceptMemory: core.mem || {}, questionMemory: core.qmem || {},
    activeSession: core.active || null, settings: core.settings, deleted: [], quarantine: core.quarantine || [], extra: {},
    currentPlan: core.plan ? core.plan.date : null
  };
  for (const l of core.lectures) { if (!l) continue; if (l.gone) ws.deleted.push({ doc: 'core.lectures', id: l.id, at: l.updatedAt || 0 }); else ws.lectures.push(l); }
  for (const r of core.resources) { if (!r) continue; if (r.gone) ws.deleted.push({ doc: 'core.resources', id: r.id, at: r.updatedAt || 0 }); else ws.resources.push(r); }
  const take = (docId: string, field: string, arr: any[] | undefined, into: any[]) => {
    for (const x of arr || []) { if (!x) continue; if (x.gone) ws.deleted.push({ doc: docId, field, id: x.id, at: x.updatedAt || 0 }); else into.push(x); }
  };
  for (const id of Object.keys(docs).sort()) {
    const d = docs[id]; if (id === 'core' || !isObj(d)) continue;
    if (id.startsWith('ses-')) take(id, 'sessions', d.sessions, ws.sessions);
    else if (id.startsWith('rev-')) { take(id, 'reviews', d.reviews, ws.reviews); take(id, 'practice', d.practice, ws.practiceAttempts); take(id, 'qattempts', d.qattempts, ws.questionAttempts); }
    else if (id.startsWith('mis-')) take(id, 'items', d.items, ws.mistakes);
    else if (id.startsWith('tb-')) take(id, 'items', d.items, ws.teachBacks);
    else if (id.startsWith('qs-')) take(id, 'items', d.items, ws.practiceQuestions);
    else if (id.startsWith('pr-')) Object.assign(ws.recallPrompts, isObj(d.byConcept) ? d.byConcept : {});
    else ws.extra[id] = d;
  }
  const by = (f: string) => (a: any, b: any) => (a[f] || 0) - (b[f] || 0);
  ws.sessions.sort(by('startedAt')); ws.reviews.sort(by('at')); ws.practiceAttempts.sort(by('at')); ws.questionAttempts.sort(by('at'));
  ws.mistakes.sort(by('at')); ws.teachBacks.sort(by('at')); ws.practiceQuestions.sort(by('createdAt'));
  return ws;
}

/* ------------------------------------------------------------------ workspace -> docs */

export function workspaceToDocs(ws0: PrepWorkspace): Docs {
  const ws = clone(ws0) as PrepWorkspace & { currentPlan?: string | null };
  const plans = { ...(ws.plans || {}) };
  const cur = ws.currentPlan && plans[ws.currentPlan] ? ws.currentPlan : null;
  const plan = cur ? plans[cur] : null; if (cur) delete plans[cur];
  const tomb = (doc: string) => ws.deleted.filter(d => d.doc === doc).map(d => ({ id: d.id, gone: true, updatedAt: d.at || 0 }));
  const core: any = { v: 2, wsid: ws.workspaceId, settings: ws.settings || {}, exams: ws.exams, nodes: ws.nodes, mem: ws.conceptMemory, qmem: ws.questionMemory,
    lectures: (ws.lectures as any[]).concat(tomb('core.lectures').map(t => ({ ...t, subjectId: '', order: 0, name: '', conceptIds: [] }))),
    resources: (ws.resources as any[]).concat(tomb('core.resources').map(t => ({ ...t, kind: 'other', title: '', on: [] }))),
    prep: ws.prep, availability: ws.availability, roadmap: ws.roadmap, active: ws.activeSession, plan, dayPlans: plans, planHistory: ws.planHistory,
    quarantine: ws.quarantine, createdAt: Date.parse(ws.createdAt) || Date.now(), updatedAt: ws.updatedAt || 0 };
  const docs: Docs = { core: migrateCore(core).core };
  const bucket = (prefix: string, field: string, ts: number, item: any, init: () => any) => {
    const id = prefix + monthKeyOf(ts || Date.now());
    const d = docs[id] || (docs[id] = Object.assign(init(), { updatedAt: 0 }));
    (d[field] || (d[field] = [])).push(item);
    d.updatedAt = Math.max(d.updatedAt, stampOf(item));
  };
  const rev = () => ({ reviews: [], practice: [] });
  ws.sessions.forEach(s => bucket('ses-', 'sessions', s.startedAt, s, () => ({ sessions: [] })));
  ws.reviews.forEach(r => bucket('rev-', 'reviews', r.at, r, rev));
  ws.practiceAttempts.forEach(p => bucket('rev-', 'practice', p.at, p, rev));
  ws.questionAttempts.forEach(a => bucket('rev-', 'qattempts', a.at, a, rev));
  ws.mistakes.forEach(m => bucket('mis-', 'items', m.at, m, () => ({ items: [] })));
  ws.teachBacks.forEach(t => bucket('tb-', 'items', t.at, t, () => ({ items: [] })));
  ws.practiceQuestions.forEach(q => bucket('qs-', 'items', q.createdAt, q, () => ({ items: [] })));
  const sOf = subjectOfConcepts(ws.nodes);
  for (const cid in ws.recallPrompts || {}) {
    const id = 'pr-' + (sOf[cid] || '_orphan');
    const d = docs[id] || (docs[id] = { byConcept: {}, updatedAt: 0 });
    d.byConcept[cid] = ws.recallPrompts[cid];
    d.updatedAt = Math.max(d.updatedAt, ...(ws.recallPrompts[cid] || []).map((p: any) => p.lastAt || 0));
  }
  const fieldOf = (doc: string) => doc.startsWith('ses-') ? 'sessions' : doc.startsWith('rev-') ? 'reviews' : 'items';
  for (const t of ws.deleted) {
    if (!DOC_ID.test(t.doc) || t.doc.startsWith('core')) continue;
    const f = t.field && /^(sessions|reviews|practice|qattempts|items)$/.test(t.field) ? t.field : fieldOf(t.doc);
    const d = docs[t.doc] || (docs[t.doc] = { updatedAt: 0 }); (d[f] || (d[f] = [])).push({ id: t.id, gone: true, updatedAt: t.at });
  }
  for (const id in ws.extra || {}) if (DOC_ID.test(id) && !docs[id] && isObj(ws.extra[id])) docs[id] = ws.extra[id];
  return docs;
}

/* ------------------------------------------------------------------ validation */

const COLLECTIONS = ['exams', 'nodes', 'lectures', 'resources', 'sessions', 'reviews', 'practiceAttempts', 'practiceQuestions', 'questionAttempts', 'mistakes', 'teachBacks'] as const;
const MAPS = ['plans', 'planHistory', 'recallPrompts', 'conceptMemory', 'questionMemory', 'extra'] as const;

/** Fills defaults, removes duplicate ids (keeping the newest), and quarantines items that cannot be used. */
export function normalizeWorkspace(raw: any): { ws: PrepWorkspace; warnings: string[] } {
  const warnings: string[] = [];
  if (!isObj(raw)) throw new WorkspaceError('The file does not contain a preparation.', 'invalid');
  const ws: any = raw;
  ws.quarantine = Array.isArray(ws.quarantine) ? ws.quarantine : [];
  ws.deleted = Array.isArray(ws.deleted) ? ws.deleted.filter((d: any) => isObj(d) && d.id && d.doc) : [];
  const q = (collection: string, item: unknown, reason: string) => ws.quarantine.push({ collection, item, reason });
  for (const k of COLLECTIONS) {
    if (ws[k] == null) ws[k] = [];
    else if (!Array.isArray(ws[k])) { q(k, ws[k], 'expected a list'); warnings.push('"' + k + '" was not a list; its content was set aside, not deleted.'); ws[k] = []; }
  }
  for (const k of MAPS) {
    if (ws[k] == null) ws[k] = {};
    else if (!isObj(ws[k])) { q(k, ws[k], 'expected an object'); warnings.push('"' + k + '" had the wrong shape; its content was set aside, not deleted.'); ws[k] = {}; }
  }
  if (!ws.workspaceId || typeof ws.workspaceId !== 'string') ws.workspaceId = newId('ws');
  if (!isObj(ws.settings)) ws.settings = {};
  if (!isObj(ws.app)) ws.app = { name: APP_NAME, format: 'prep-workspace' };
  ws.createdAt = typeof ws.createdAt === 'string' ? ws.createdAt : iso(Date.now());
  ws.updatedAt = num(ws.updatedAt, 0);
  ws.prep = normPrep(ws.prep);
  ws.availability = normAvailability(ws.availability, num(ws.settings.avail, num(ws.settings.dailyMin, 120)));
  if (ws.roadmap != null && !isObj(ws.roadmap)) { q('roadmap', ws.roadmap, 'expected an object'); ws.roadmap = null; }
  if (ws.activeSession != null && !(isObj(ws.activeSession) && isFinite(ws.activeSession.startedAt))) { q('activeSession', ws.activeSession, 'running timer without a start time'); ws.activeSession = null; }
  // ids: every item needs one, and each id appears once per collection (newest copy wins)
  let fixed = 0, dups = 0, bad = 0;
  for (const k of COLLECTIONS) {
    const seen = new Map<string, number>(); const out: any[] = [];
    for (const item of ws[k]) {
      if (!isObj(item)) { q(k, item, 'not an object'); bad++; continue; }
      if (item.id == null || item.id === '') { item.id = newId('fix'); fixed++; }
      item.id = String(item.id);
      const at = seen.get(item.id);
      if (at == null) { seen.set(item.id, out.length); out.push(item); continue; }
      dups++;
      if (stampOf(item) > stampOf(out[at])) { q(k, out[at], 'duplicate id, older copy'); out[at] = item; } else q(k, item, 'duplicate id, older copy');
    }
    ws[k] = out;
  }
  if (fixed) warnings.push(fixed + ' item' + (fixed > 1 ? 's' : '') + ' had no id and got a new one.');
  if (dups) warnings.push(dups + ' duplicate id' + (dups > 1 ? 's were' : ' was') + ' found; the newest copy of each was kept and the others set aside.');
  // shape checks that would otherwise break the app
  const keep = (k: string, ok: (x: any) => boolean, reason: string) => { const out: any[] = []; for (const x of ws[k]) { if (ok(x)) out.push(x); else { q(k, x, reason); bad++; } } ws[k] = out; };
  keep('nodes', n => ['subject', 'topic', 'subtopic', 'concept'].includes(n.kind) && typeof n.name === 'string', 'syllabus item without a kind or name');
  keep('sessions', s => isFinite(s.startedAt) && isFinite(s.endedAt) && s.endedAt >= s.startedAt && isFinite(s.focusSec) && s.focusSec >= 0, 'session with impossible times');
  keep('reviews', r => r.cid && isFinite(r.at), 'recall without a concept or time');
  keep('practiceAttempts', p => p.cid && isFinite(p.at) && isFinite(p.n), 'practice record without a concept or count');
  keep('questionAttempts', a => a.qid && isFinite(a.at) && ['correct', 'partial', 'incorrect'].includes(a.result), 'question attempt without a result');
  keep('practiceQuestions', x => typeof x.text === 'string' && x.text.trim(), 'question without text');
  keep('mistakes', m => isFinite(m.at), 'mistake without a date');
  keep('lectures', l => l.subjectId && typeof l.subjectId === 'string', 'lecture without a subject');
  for (const q2 of ws.practiceQuestions) if (!isFinite(q2.createdAt)) q2.createdAt = Date.now();
  for (const l of ws.lectures) { if (!Array.isArray(l.conceptIds)) l.conceptIds = []; if (!isFinite(l.order)) l.order = 0; if (typeof l.name !== 'string') l.name = ''; }
  for (const m of ws.mistakes) { if (!isFinite(m.next)) m.next = m.at; if (!isFinite(m.stage)) m.stage = 0; }
  if (bad) warnings.push(bad + ' unreadable item' + (bad > 1 ? 's were' : ' was') + ' set aside in the file (under "quarantine"), not deleted.');
  for (const e of ws.exams as Exam[]) {
    if (e.date && !isDateKey(e.date)) { warnings.push('Exam "' + (e.name || 'untitled') + '" had an invalid date (' + e.date + '); set it again in Settings.'); q('exams.date', { id: e.id, date: e.date }, 'invalid date'); delete e.date; }
    if (e.startDate && !isDateKey(e.startDate)) delete e.startDate;
  }
  for (const k of ['conceptMemory', 'questionMemory'] as const) {
    for (const id in ws[k]) { const m = ws[k][id]; if (!isObj(m) || !isFinite(m.due)) { q(k, { id, m }, 'memory record without a due date'); delete ws[k][id]; } }
  }
  const ids = new Set(ws.nodes.map((n: SyllabusNode) => n.id));
  const orphans = ws.nodes.filter((n: SyllabusNode) => n.kind !== 'subject' && (!n.parentId || !ids.has(n.parentId))).length;
  if (orphans) warnings.push(orphans + ' syllabus item' + (orphans > 1 ? 's point' : ' points') + ' to a parent that no longer exists and will not be shown.');
  ws.subjects = ws.nodes.filter((n: SyllabusNode) => n.kind === 'subject');
  if (!ws.exam || !isObj(ws.exam)) ws.exam = ws.exams.find((e: Exam) => e.id === ws.settings.activeExamId) || ws.exams[0] || null;
  ws.schemaVersion = SCHEMA_VERSION;
  return { ws: ws as PrepWorkspace, warnings };
}

/* ------------------------------------------------------------------ reading any supported file */

export function detectFormat(raw: unknown): WorkspaceSource | 'future' | null {
  if (!isObj(raw)) return null;
  if (raw.app && isObj(raw.app) && raw.app.format === 'prep-workspace' || (typeof raw.schemaVersion === 'number' && 'workspaceId' in raw)) {
    return Number(raw.schemaVersion) > SCHEMA_VERSION ? 'future' : 'v2';
  }
  if (raw.app === 'logbook' && isObj(raw.docs)) return 'v1-backup';
  if (isObj(raw.core) && (Array.isArray(raw.core.nodes) || isObj(raw.core.settings))) return 'v1-docs';
  if (Array.isArray(raw.nodes) && isObj(raw.settings) && isObj(raw.mem)) return 'v1-core';
  return null;
}

export function readWorkspace(raw: unknown): { ws: PrepWorkspace; source: WorkspaceSource; warnings: string[] } {
  const f = detectFormat(raw);
  if (f === 'future') throw new WorkspaceError('This file was saved by a newer version of ' + APP_NAME + ' (schema ' + (raw as any).schemaVersion + '). Update the app to open it; the file was not changed.', 'unsupported-version');
  if (!f) throw new WorkspaceError('This JSON file is not a preparation file or a Logbook backup.', 'not-workspace');
  let ws: any;
  if (f === 'v2') ws = raw;
  else if (f === 'v1-backup') ws = docsToWorkspace(clone((raw as any).docs));
  else if (f === 'v1-docs') ws = docsToWorkspace(clone(raw as Docs));
  else ws = docsToWorkspace({ core: clone(raw) });
  const { ws: out, warnings } = normalizeWorkspace(ws);
  return { ws: out, source: f, warnings };
}

export function parseWorkspaceText(text: string): { ws: PrepWorkspace; source: WorkspaceSource; warnings: string[] } {
  if (!String(text || '').trim()) throw new WorkspaceError('The file is empty.', 'invalid-json');
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (e) {
    const m = /position (\d+)/.exec(String((e as Error).message || ''));
    const where = m ? ' near line ' + (String(text).slice(0, Number(m[1])).split('\n').length) : '';
    throw new WorkspaceError('The file is not valid JSON' + where + '. It may be damaged or only partly saved. Nothing was changed.', 'invalid-json');
  }
  return readWorkspace(raw);
}

/** Old per-file data (core.json, ses-2026-09.json …), e.g. downloaded from the GitHub data repository. */
export function docsFromFiles(files: { name: string; text: string }[]): { docs: Docs; skipped: string[] } {
  const docs: Docs = {}, skipped: string[] = [];
  for (const f of files) {
    const id = String(f.name || '').replace(/^.*[\\/]/, '').replace(/\.json$/i, '');
    if (!DOC_ID.test(id)) { skipped.push(f.name); continue; }
    try { const body = JSON.parse(f.text); if (isObj(body)) docs[id] = body; else skipped.push(f.name); } catch { skipped.push(f.name); }
  }
  return { docs, skipped };
}

export function serializeWorkspace(ws: PrepWorkspace): string { return JSON.stringify(ws, null, 2) + '\n'; }

export function workspaceSummary(ws: PrepWorkspace) {
  const nodes = ws.nodes || [];
  return { exam: ws.exam ? ws.exam.name : null, examDate: ws.exam ? ws.exam.date || null : null,
    subjects: nodes.filter(n => n.kind === 'subject' && !n.archived).length, concepts: nodes.filter(n => n.kind === 'concept').length,
    lectures: (ws.lectures || []).length, sessions: (ws.sessions || []).length, questions: (ws.practiceQuestions || []).length, savedAt: ws.savedAt };
}
/** A cheap content fingerprint so the app can tell whether the file changed outside it. */
export function fingerprint(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + text.length;
}
export type { MemoryRecord, Resource };
