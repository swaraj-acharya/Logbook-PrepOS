/*
 * Logbook PrepOS browser UI. Renders views into the shell from components/Logbook.tsx and handles all interaction.
 * Pure logic lives in lib/ (engine, roadmap, dayplan, lectures, practice, workspace). Persistence: a copy in this
 * browser, the preparation file on this computer (lib/storage/local-file.ts) and, when the server is configured for
 * it, the optional account sync through /api/docs and /api/sync. New views live in client/prep-ui.js.
 */
import {
  MIN, HOUR, DAY, pad, clamp, uid, sum, ymd, dayKey, keyToDate, dayStart, addDays, daysBetween, weekStart, monthStart, monthKeyOf, rangeKeys,
  fmtDur, fmtClock, Memory, STATES, masteryOf, stateOf, topicStatus, MODE_GROUP, buildRollup, sumRange, splitOf, DEFAULT_MIX, DEFAULT_WEIGHTS,
  examPhase, reviewPriority, planDay, parseStudyText, parseDuration, parseDate, toks
} from '../lib/engine.js';
import { PALETTE, EVIDENCE, HEURISTICS, DATA_MODEL_TS, ARCH_NOTES } from '../lib/seed.js';
import { mergeDoc, differs } from '../lib/merge.js';
import { migrateCore, newCore } from '../lib/workspace';
import { calendarToday, isDateKey } from '../lib/dates';
import { FileSync, idbKV, browserPickers } from '../lib/storage/local-file';
import { candidates, keepOnRegenerate, buildDay, detectMissed, projectDays } from '../lib/dayplan';
import { buildPhases, phaseOn, capacity, estimateWork, assessFeasibility, forecastCompletion, subjectOrder, subjectTimeline, coverageEnd,
  requiredLearnShare, learnShare, adaptMix, minutesOn, isWeekendDay, lectureDates } from '../lib/roadmap';
import { lectureLabels, lectureProgress, lectureStats, live as liveLectures } from '../lib/lectures';
import { practiceSignal } from '../lib/practice';
import * as PREP from './prep-ui.js';

let CFG = {};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const plural = (n, w, pl) => n + ' ' + (n === 1 ? w : (pl || w + 's'));
const pct = x => x == null ? '–' : Math.round(x * 100) + '%';

const MODES = [['lecture', 'Lecture or video'], ['reading', 'Reading'], ['notes', 'Note-making'], ['recall', 'Recall'], ['practice', 'Problem solving'], ['revision', 'Revision'], ['mistakes', 'Mistake review'], ['teachback', 'Teach-back'], ['mock', 'Mock test'], ['mixed', 'Mixed']];
const MODE_NAME = Object.fromEntries(MODES);
const GROUP_NAME = { taking: 'Taking in', making: 'Making', retrieving: 'Retrieving and applying', mixed: 'Mixed' };
const GROUP_DESC = { taking: 'lecture, reading, revision', making: 'notes, teach-back, mistake review', retrieving: 'recall, practice, mocks', mixed: 'mixed sessions' };
const STYLES = [['stopwatch', 'Stopwatch', 0], ['focus', 'Focus timer', 45], ['pomodoro', 'Pomodoro', 0], ['deep', 'Deep work', 90], ['recall', 'Recall sprint', 10], ['practice', 'Practice sprint', 30], ['mock', 'Mock exam', 180]];
const STYLE_NAME = Object.fromEntries(STYLES.map(s => [s[0], s[1]]));
const MISTAKE_TYPES = [['concept', 'Concept'], ['formula', 'Formula'], ['calculation', 'Calculation'], ['unit', 'Unit'], ['sign', 'Sign'], ['misreading', 'Misreading'], ['reasoning', 'Reasoning'], ['memory', 'Memory'], ['time', 'Time pressure'], ['careless', 'Carelessness'], ['guess', 'Guess']];
const MT_NAME = Object.fromEntries(MISTAKE_TYPES);
const RETRY_STAGES = [[1, 'Short-delay retry'], [3, 'Independent retry'], [7, 'Similar problem'], [21, 'Longer-delay review']];
const PROMPT_KINDS = [['free', 'Free recall'], ['formula', 'Formula'], ['blank', 'Fill in the blank'], ['explain', 'Explain why'], ['compare', 'Compare'], ['diagram', 'Draw from memory'], ['application', 'Application'], ['problem', 'Problem']];
const PK_NAME = Object.fromEntries(PROMPT_KINDS);
const LEVELS = [['basic', 'Basic'], ['standard', 'Standard'], ['advanced', 'Advanced'], ['unfamiliar', 'Unfamiliar']];
const KIND_NAME = { review: 'Review', new: 'New learning', practice: 'Practice', mistakes: 'Mistakes', cumulative: 'Cumulative recall', break: 'Break',
  lecture: 'Lecture', selfstudy: 'Self-study', recall: 'Recall', qreview: 'Question review' };
const PHASE_TEXT = { early: 'Early phase: mostly new learning, with recall from day one.', middle: 'Middle phase: new learning, recall and practice together.', final: 'Final phase: revision, saved questions, mock tests and mistakes.' };

const DEFAULT_SETTINGS = {
  name: '', dailyMin: 120, weeklyMin: 840, monthlyMin: 3600, avail: null,
  goal: { newConcepts: 2, reviews: 10, questions: 15 },
  retention: 0.9, dayStartHour: 4, idleMin: 10, minPerReview: 1.5, capToExam: true,
  pomo: { focus: 25, brk: 5, longBrk: 15, every: 4 },
  mix: clone(DEFAULT_MIX), weights: clone(DEFAULT_WEIGHTS), activeExamId: null, theme: 'auto'
};

/* ---------------- storage: browser copy + JSON files in the GitHub repository (via /api) ---------------- */
let LS = 'lb1:';
const Store = {
  docs: {}, shas: {}, dirty: new Set(), remote: false, mode: 'local', t: null, due: 0, flushing: false, warned: {}, error: '', backoff: 0,
  loadLocal() {
    try {
      const idx = JSON.parse(localStorage.getItem(LS + '__index') || '[]');
      for (const id of idx) { const raw = localStorage.getItem(LS + id); if (raw) this.docs[id] = JSON.parse(raw); }
      if (!idx.length && !CFG.server) this.adoptLegacy();
    } catch (e) { /* storage unavailable: run in memory */ }
  },
  /* Browser-only mode after using the app with an account: take over the newest copy kept in this browser (it is copied, not moved). */
  adoptLegacy() {
    let best = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), m = /^lb1:(.+):__index$/.exec(k || '');
      if (!m || 'lb1:' + m[1] + ':' === LS) continue;
      try { const core = JSON.parse(localStorage.getItem('lb1:' + m[1] + ':core') || 'null'); if (core && (!best || (core.updatedAt || 0) > best.at)) best = { pre: 'lb1:' + m[1] + ':', at: core.updatedAt || 0 }; } catch (e) { /* skip */ }
    }
    if (!best) return;
    const idx = JSON.parse(localStorage.getItem(best.pre + '__index') || '[]');
    for (const id of idx) { const raw = localStorage.getItem(best.pre + id); if (raw) { this.docs[id] = JSON.parse(raw); this.saveLocal(id); } }
    this.adopted = true;
  },
  saveLocal(id) {
    try {
      if (this.docs[id]) localStorage.setItem(LS + id, JSON.stringify(this.docs[id])); else localStorage.removeItem(LS + id);
      localStorage.setItem(LS + '__index', JSON.stringify(Object.keys(this.docs)));
    } catch (e) { if (!this.warned.ls) { this.warned.ls = 1; toast('This browser could not keep a local copy. Save to a preparation file to keep your work.'); } }
  },
  touch(id, now) {
    if (!this.docs[id]) return;
    this.docs[id].updatedAt = Date.now();
    this.dirty.add(id); this.saveLocal(id); invalidate();
    // Batch edits: one commit every few seconds at most, sooner for timer start/stop.
    if (this.remote) this.schedule(now ? 2500 : 8000);
    if (FS) FS.markDirty();
    setSaveStatus();
  },
  /* Puts documents from the preparation file (or an opened copy) into the app without touching their timestamps. */
  setDocs(docs, mode) {
    if (mode === 'replace') {
      for (const id of Object.keys(this.docs)) if (!(id in docs)) { delete this.docs[id]; if (this.remote) this.dirty.add(id); this.saveLocal(id); }
      for (const id in docs) { this.docs[id] = docs[id]; this.saveLocal(id); if (this.remote) this.dirty.add(id); }
    } else {
      for (const id of new Set([...Object.keys(this.docs), ...Object.keys(docs)])) {
        const merged = mergeDoc(id, this.docs[id], docs[id]);
        if (differs(merged, this.docs[id])) { if (merged) this.docs[id] = merged; else delete this.docs[id]; this.saveLocal(id); if (this.remote) this.dirty.add(id); }
      }
    }
    if (!this.docs.core) this.docs.core = freshCore();
    normalizeCore(); invalidate(); ui.rev = null; ui.qrev = null;
    if (this.remote && this.dirty.size) this.schedule(1500);
    if (mounted) { if (!ui.modal || ui.modal.type === 'storage') render(); }
  },
  schedule(ms) {
    const at = Date.now() + ms;
    if (this.t && this.due && this.due <= at) return;
    clearTimeout(this.t); this.due = at; this.t = setTimeout(() => { this.t = null; this.due = 0; this.flush(); }, ms);
  },
  payload(ids) {
    const changes = {};
    for (const id of ids) changes[id] = { body: this.docs[id] || null, baseSha: this.shas[id] || null };
    return changes;
  },
  async flush() {
    if (!this.remote) { setSaveStatus(); return; }
    if (this.flushing) { this.schedule(1500); return; }
    if (!this.dirty.size) { setSaveStatus(); return; }
    this.flushing = true; setSaveStatus();
    const ids = [...this.dirty]; this.dirty.clear();
    let rerender = false;
    try {
      const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: this.payload(ids) }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { ids.forEach(id => this.dirty.add(id)); this.remote = false; this.mode = 'signedout'; toast('You were signed out. Changes stay in this browser; sign in again to save them.'); return; }
      if (!r.ok) throw new Error(j.error || 'Save failed (' + r.status + ')');
      for (const id in j.saved || {}) { if (j.saved[id]) this.shas[id] = j.saved[id]; else delete this.shas[id]; }
      for (const id in j.conflicts || {}) {
        const c = j.conflicts[id];
        if (c.sha) this.shas[id] = c.sha; else delete this.shas[id];
        const merged = mergeDoc(id, this.docs[id], c.body);
        if (!differs(merged, this.docs[id])) { if (c.body && differs(merged, c.body)) this.dirty.add(id); continue; }
        if (merged) this.docs[id] = merged; else delete this.docs[id];
        this.saveLocal(id); rerender = true;
        if (!c.body || differs(merged, c.body)) this.dirty.add(id);
      }
      this.error = ''; this.backoff = 0;
      if (this.dirty.size) this.schedule(1000);
    } catch (e) {
      ids.forEach(id => this.dirty.add(id));
      this.error = (e && e.message) || 'offline';
      this.backoff = Math.min(120000, (this.backoff || 5000) * 2);
      this.schedule(this.backoff);
    } finally {
      this.flushing = false; setSaveStatus();
      if (rerender) { normalizeCore(); invalidate(); if (!ui.modal && !typing(document.activeElement)) render(); }
    }
  },
  /* Best effort when the page is closing; anything missed is pushed on the next visit (newer local copies win). */
  flushOnExit() {
    if (!this.remote || !this.dirty.size) return;
    const body = JSON.stringify({ changes: this.payload([...this.dirty]) });
    if (body.length < 60000) { try { fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }); } catch (e) { } }
  },
  async connect() {
    if (!CFG.server) { this.mode = 'local'; setSaveStatus(); return; }
    let j;
    try {
      const r = await fetch('/api/docs', { cache: 'no-store' });
      if (r.status === 401) { location.href = '/login'; return; }
      j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load data');
    } catch (e) {
      this.mode = 'offline'; this.error = (e && e.message) || 'offline'; setSaveStatus();
      toast('Could not reach storage. Working from this browser; changes will be saved when the connection is back.');
      setTimeout(() => this.connect(), 30000);
      return;
    }
    const remote = j.docs || {};
    for (const id in remote) {
      this.shas[id] = remote[id].sha;
      const merged = mergeDoc(id, this.docs[id], remote[id].body);
      if (differs(merged, this.docs[id])) { this.docs[id] = merged; this.saveLocal(id); }
      if (differs(merged, remote[id].body)) this.dirty.add(id);
    }
    for (const id in this.docs) if (!remote[id]) this.dirty.add(id);
    this.remote = true; this.mode = 'account'; this.error = '';
    normalizeCore(); invalidate(); render(); resumeCheck(); this.schedule(300);
  }
};
/* One line describing where the latest changes are. The preparation file comes first; account sync is secondary. */
function saveStatusInfo() {
  const f = FS ? FS.status() : { state: 'nofile', fileName: null, message: '' };
  const where = CFG.storage && CFG.storage.startsWith('GitHub') ? 'GitHub' : 'the server';
  const server = Store.mode === 'account' ? (Store.error ? 'Not saved to ' + where + ' yet: retrying' : Store.dirty.size || Store.flushing ? 'Saving to ' + where + '…' : 'Saved to ' + where)
    : Store.mode === 'offline' ? 'Offline: account sync paused' : Store.mode === 'signedout' ? 'Signed out: account sync paused' : '';
  const name = f.fileName || 'the progress file';
  const byState = { saved: ['ok', 'Saved to ' + name], saving: ['busy', 'Saving to ' + name + '…'], unsaved: ['busy', 'Unsaved changes'],
    permission: ['warn', 'Permission required for ' + name], unavailable: ['bad', name + ' is unavailable'], failed: ['bad', 'Save failed'],
    blocked: ['bad', 'Cannot read ' + name], idle: ['busy', 'Opening…'], nofile: Store.mode === 'account' ? ['ok', server] : ['warn', 'Not saved to a file yet'] };
  const [tone, text] = byState[f.state] || ['warn', 'Not saved to a file yet'];
  return { tone, text, file: f, server, detail: f.message || Store.error || '' };
}
function setSaveStatus() {
  const info = saveStatusInfo();
  for (const el of document.querySelectorAll('.save-status')) {
    el.innerHTML = `<span class="sdot ${info.tone}" aria-hidden="true"></span><span>${esc(info.text)}</span>`;
    el.title = [info.detail, info.server].filter(Boolean).join('. ');
  }
  const b = $('#storage-banner'); if (b) b.innerHTML = PREP.storageBanner(info);
}

function freshCore() { return newCore(clone(DEFAULT_SETTINGS)); }
function core() { return Store.docs.core || (Store.docs.core = freshCore()); }
function normalizeCore() {
  const c = core();
  const mig = migrateCore(c);
  if (mig.warnings.length) mig.warnings.forEach(w => setTimeout(() => toast(w), 400));
  c.settings = Object.assign(clone(DEFAULT_SETTINGS), c.settings || {});
  c.settings.goal = Object.assign(clone(DEFAULT_SETTINGS.goal), c.settings.goal || {});
  c.settings.pomo = Object.assign(clone(DEFAULT_SETTINGS.pomo), c.settings.pomo || {});
  c.settings.weights = Object.assign(clone(DEFAULT_WEIGHTS), c.settings.weights || {});
  c.settings.mix = Object.assign(clone(DEFAULT_MIX), c.settings.mix || {});
  c.exams = c.exams || []; c.nodes = c.nodes || []; c.mem = c.mem || {};
  applyTheme();
}
let FS = null;          // the preparation file controller (created on mount)
function applyTheme() {
  const t = core().settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
}

/* month-bucketed documents */
function mdoc(prefix, ts, init) {
  const id = prefix + monthKeyOf(ts);
  if (!Store.docs[id]) Store.docs[id] = Object.assign(init(), { updatedAt: 0 });
  return [id, Store.docs[id]];
}
function allOf(prefix, field) { const out = []; for (const id in Store.docs) if (id.startsWith(prefix)) out.push(...(Store.docs[id][field] || []).filter(x => x && !x.gone)); return out; }
function findIn(prefix, field, id) {
  for (const k in Store.docs) if (k.startsWith(prefix)) {
    const arr = Store.docs[k][field] || []; const i = arr.findIndex(x => x.id === id && !x.gone);
    if (i >= 0) return { docId: k, arr, i, item: arr[i] };
  }
  return null;
}
function putItem(prefix, field, ts, item, now) {
  const want = prefix + monthKeyOf(ts);
  const f = findIn(prefix, field, item.id);
  if (f && f.docId === want) { f.arr[f.i] = item; Store.touch(want, now); return; }
  if (f) { f.arr[f.i] = { id: item.id, gone: true, updatedAt: Date.now() }; Store.touch(f.docId); } // tombstone so other devices do not bring it back
  const [id, d] = mdoc(prefix, ts, () => ({ [field]: [] }));
  (d[field] || (d[field] = [])).push(item); Store.touch(id, now);
}
function saveSession(s, now) { s.split = computeSplit(s); s.updatedAt = Date.now(); putItem('ses-', 'sessions', s.startedAt, s, now); }
function addReview(r) { const [id, d] = mdoc('rev-', r.at, () => ({ reviews: [], practice: [] })); (d.reviews || (d.reviews = [])).push(r); Store.touch(id); }
function addPractice(p) { const [id, d] = mdoc('rev-', p.at, () => ({ reviews: [], practice: [] })); (d.practice || (d.practice = [])).push(p); Store.touch(id); }
function saveMistake(m) { m.updatedAt = Date.now(); putItem('mis-', 'items', m.at, m); }
function addTeach(t) { t.updatedAt = Date.now(); putItem('tb-', 'items', t.at, t); }
function saveQuestion(q) { q.updatedAt = Date.now(); putItem('qs-', 'items', q.createdAt, q); }
function addQAttempt(a) { const [id, d] = mdoc('rev-', a.at, () => ({ reviews: [], practice: [], qattempts: [] })); (d.qattempts || (d.qattempts = [])).push(a); Store.touch(id); }
function removeQuestion(qid) { const r = findIn('qs-', 'items', qid); if (r) { r.arr[r.i] = { id: qid, gone: true, updatedAt: Date.now() }; Store.touch(r.docId); } delete core().qmem[qid]; Store.touch('core'); }
function promptsFor(cid) { const sid = derive().subjOf[cid]; const d = Store.docs['pr-' + sid]; return (d && d.byConcept && d.byConcept[cid]) || []; }
function setPrompts(cid, arr) {
  const sid = derive().subjOf[cid]; if (!sid) return;
  const id = 'pr-' + sid; if (!Store.docs[id]) Store.docs[id] = { byConcept: {}, updatedAt: 0 };
  Store.docs[id].byConcept[cid] = arr; Store.touch(id);
}

/* ---------------- derived state (cached ~30 s or until data changes) ---------------- */
let DV = null;
function invalidate() { DV = null; }
function derive() {
  const now = Date.now();
  if (DV && now - DV.now < 30000) return DV;
  const c = core(), S = c.settings, sh = S.dayStartHour;
  const byId = {}, kids = {};
  c.nodes.forEach(n => { byId[n.id] = n; (kids[n.parentId || '_root'] || (kids[n.parentId || '_root'] = [])).push(n); });
  for (const k in kids) kids[k].sort((a, b) => (a.order || 0) - (b.order || 0));
  const subjects = (kids._root || []).filter(n => n.kind === 'subject');
  const subjOf = {}, topicOf = {}, subtopicOf = {}, orderIdx = {}, archivedChain = {};
  let oi = 0;
  const walk = (n, s, t, u, arch) => {
    const a = arch || !!n.archived;
    if (n.kind === 'subject') s = n.id; else if (n.kind === 'topic') t = n.id; else if (n.kind === 'subtopic') u = n.id;
    subjOf[n.id] = s; topicOf[n.id] = t; subtopicOf[n.id] = u; orderIdx[n.id] = oi++; archivedChain[n.id] = a;
    (kids[n.id] || []).forEach(k => walk(k, s, t, u, a));
  };
  subjects.forEach(s => walk(s, null, null, null, false));
  const concepts = c.nodes.filter(n => n.kind === 'concept' && subjOf[n.id]);
  const sessions = allOf('ses-', 'sessions').sort((a, b) => a.startedAt - b.startedAt);
  const live = sessions.filter(s => s.status !== 'discarded');
  const reviews = allOf('rev-', 'reviews').sort((a, b) => a.at - b.at);
  const practice = allOf('rev-', 'practice').sort((a, b) => a.at - b.at);
  const mistakes = allOf('mis-', 'items').sort((a, b) => b.at - a.at);
  const teach = allOf('tb-', 'items').sort((a, b) => a.at - b.at);
  const questions = allOf('qs-', 'items').sort((a, b) => a.createdAt - b.createdAt);
  const qattempts = allOf('rev-', 'qattempts').sort((a, b) => a.at - b.at);
  const qById = {}, qAtt = {}; questions.forEach(q => { qById[q.id] = q; }); qattempts.forEach(a => (qAtt[a.qid] || (qAtt[a.qid] = [])).push(a));
  const lectures = liveLectures(c.lectures || []).filter(l => byId[l.subjectId]).sort((a, b) => (orderIdx[a.subjectId] - orderIdx[b.subjectId]) || (a.order - b.order));
  const lecLab = lectureLabels(lectures), lecOfC = {};
  lectures.forEach(l => (l.conceptIds || []).forEach(cid => (lecOfC[cid] || (lecOfC[cid] = [])).push(l)));
  const I = {};
  const get = id => I[id] || (I[id] = { sessions: [], reviews: [], practice: [], mistakes: [], teach: [], sec: 0 });
  live.forEach(s => { (s.conceptIds || []).forEach(cid => get(cid).sessions.push(s)); splitOf(s).forEach(p => { if (p.c) get(p.c).sec += p.sec; }); });
  reviews.forEach(r => get(r.cid).reviews.push(r));
  practice.forEach(p => get(p.cid).practice.push(p));
  mistakes.forEach(m => { if (m.cid) get(m.cid).mistakes.push(m); });
  teach.forEach(t => get(t.cid).teach.push(t));
  const EMPTY = { sessions: [], reviews: [], practice: [], mistakes: [], teach: [], sec: 0 };
  const cinfo = {};
  concepts.forEach(cn => {
    const ix = I[cn.id] || EMPTY, m = c.mem[cn.id];
    const mastery = masteryOf(ix, m, now);
    cinfo[cn.id] = { ix, m, mastery, state: stateOf(ix, m, now, mastery), R: Memory.recall(m, now) };
  });
  const dependents = {};
  concepts.forEach(cn => (cn.prereq || []).forEach(p => (dependents[p] || (dependents[p] = [])).push(cn.id)));
  const lecEvidence = l => { let recalledAt = null, practicedAt = null; (l.conceptIds || []).forEach(cid => { const ix = I[cid]; if (!ix) return; ix.reviews.forEach(r => { if (r.g >= 2 && (!recalledAt || r.at > recalledAt)) recalledAt = r.at; }); ix.practice.forEach(p => { if (!practicedAt || p.at > practicedAt) practicedAt = p.at; }); }); return { recalledAt, practicedAt }; };
  const lecProg = {}; lectures.forEach(l => { lecProg[l.id] = lectureProgress(l, lecEvidence(l)); });
  DV = { now, today: dayKey(now, sh), cal: calendarToday(now), sh, byId, kids, subjects, concepts, subjOf, topicOf, subtopicOf, orderIdx, archivedChain, dependents,
    sessions, live, reviews, practice, mistakes, teach, I, cinfo, days: buildRollup(live, sh), EMPTY,
    questions, qattempts, qById, qAtt, lectures, lecLab, lecOfC, lecProg, lecEvidence };
  return DV;
}
const N = id => derive().byId[id];
function pathParts(id) { const d = derive(), out = []; let n = d.byId[id], g = 0; while (n && g++ < 8) { out.unshift(n); n = d.byId[n.parentId]; } return out; }
function pathStr(id, from) { return pathParts(id).slice(from || 0).map(n => n.name).join(' › '); }
function subjColor(sid) { const s = N(sid); return (s && s.color) || 'var(--faint)'; }
function subjName(sid) { const s = N(sid); return s ? s.name : (sid === '_none' || !sid ? 'Mixed or unassigned' : 'Removed subject'); }
function activeExam() { const c = core(); return c.exams.find(e => e.id === c.settings.activeExamId) || c.exams.find(e => !e.archived) || null; }
/* The exam countdown follows the calendar (midnight), not the study day. */
function daysLeft() { const ex = activeExam(); return ex && ex.date && isDateKey(ex.date) ? daysBetween(calendarToday(), ex.date) : null; }
function examSubjects(withArchived, examId) {
  const d = derive(); const ex = examId === undefined ? activeExam() : (examId ? core().exams.find(e => e.id === examId) : null);
  return d.subjects.filter(s => (withArchived || !s.archived) && (!ex || !s.examIds || !s.examIds.length || s.examIds.includes(ex.id)));
}
function conceptsUnder(id) { const d = derive(); const out = []; const go = n => (d.kids[n] || []).forEach(k => { if (k.kind === 'concept') out.push(k); go(k.id); }); go(id); return out; }
function impOf(cid) { const n = N(cid); if (n && n.imp) return n.imp; const s = N(derive().subjOf[cid]); return (s && s.imp) || 2; }
function isLiveConcept(cn) { const d = derive(); return !d.archivedChain[cn.id]; }
function computeSplit(s) {
  const d = derive(), f = s.focusSec || 0;
  const cids = (s.conceptIds || []).filter(id => d.byId[id]);
  if (cids.length) { const per = f / cids.length; return cids.map(c => ({ s: d.subjOf[c], t: d.topicOf[c], u: d.subtopicOf[c], c, sec: per })); }
  const anchor = s.subtopicId || s.topicId;
  return [{ s: s.subjectId || null, t: anchor ? d.topicOf[anchor] : null, u: s.subtopicId || null, c: null, sec: f }];
}

/* ---------------- syllabus editing ---------------- */
function addNode(kind, parentId, name, extra) {
  const c = core(); const sibs = c.nodes.filter(n => (n.parentId || null) === (parentId || null));
  const n = Object.assign({ id: uid(kind[0]), kind, parentId: parentId || null, name: name.trim(), order: sibs.length ? Math.max(...sibs.map(s => s.order || 0)) + 1 : 0, createdAt: Date.now() }, extra || {});
  c.nodes.push(n); Store.touch('core'); return n;
}
function removeNode(id) {
  const c = core(); const kill = new Set([id]);
  let grew = true; while (grew) { grew = false; c.nodes.forEach(n => { if (n.parentId && kill.has(n.parentId) && !kill.has(n.id)) { kill.add(n.id); grew = true; } }); }
  c.nodes = c.nodes.filter(n => !kill.has(n.id));
  c.nodes.forEach(n => { if (n.prereq) n.prereq = n.prereq.filter(p => !kill.has(p)); });
  kill.forEach(k => delete c.mem[k]);
  Store.touch('core');
}
function moveNode(id, dir) {
  const c = core(); const n = c.nodes.find(x => x.id === id); if (!n) return;
  const sibs = c.nodes.filter(x => (x.parentId || null) === (n.parentId || null) && x.kind === n.kind).sort((a, b) => a.order - b.order);
  const i = sibs.indexOf(n), j = i + dir; if (j < 0 || j >= sibs.length) return;
  sibs.splice(i, 1); sibs.splice(j, 0, n); sibs.forEach((s, k) => s.order = k); Store.touch('core');
}
/* ---------------- planning: adapters from live data to the pure planner (lib/dayplan.ts, lib/roadmap.ts) ---------------- */
function extraPerDay() { const P = core().prep; return P.effort === 'extra' ? P.extraMinPerDay || 0 : 0; }
function availOn(k) { return minutesOn(k, core().availability, extraPerDay()); }
function windowsOn(k) { const A = core().availability; return (isWeekendDay(k, A) ? A.weekend.windows : A.weekday.windows) || []; }
function subjectsPerDayOn(k) { const P = core().prep, A = core().availability; return isWeekendDay(k, A) ? P.subjectsPerDay.weekend : P.subjectsPerDay.weekday; }
function openMistakes() { return derive().mistakes.filter(m => !m.resolved); }
function questionSubject(q) { return q.subjectId || (q.conceptId ? derive().subjOf[q.conceptId] : null) || null; }
/** Target share per subject (0–1): your planned % where set, otherwise importance and difficulty; rebalanced toward remaining work. */
function subjectShares(subs, work) {
  const byW = {}; (work ? work.subjects : []).forEach(w => { byW[w.id] = w.learnMin + w.practiceMin; });
  const userTot = sum(subs.map(s => s.share > 0 ? s.share : 0));
  const autoW = s => (s.imp || 2) * ({ 1: 0.85, 2: 1, 3: 1.25 }[s.diff || 2] || 1);
  const autoSubs = subs.filter(s => !(s.share > 0)), autoTot = sum(autoSubs.map(autoW)) || 1;
  const left = userTot >= 100 ? 0 : 100 - userTot;
  const base = {}; subs.forEach(s => { base[s.id] = s.share > 0 ? s.share : (userTot ? left : 100) * autoW(s) / autoTot; });
  const rems = subs.map(s => byW[s.id] || 0), mean = (sum(rems) / Math.max(1, rems.length)) || 1;
  const dyn = {}; subs.forEach(s => { dyn[s.id] = base[s.id] * (work ? 0.5 + 0.5 * (byW[s.id] || 0) / mean : 1); });
  const t = sum(Object.values(dyn)) || 1; for (const k in dyn) dyn[k] /= t;
  return { base, dyn };
}
function subjectWorkInput(s) {
  const d = derive(), c = core();
  const cs = conceptsUnder(s.id).filter(cn => !d.archivedChain[cn.id]);
  const lecs = d.lectures.filter(l => l.subjectId === s.id);
  const lecOpen = cid => (d.lecOfC[cid] || []).some(l => !d.lecProg[l.id].covered);
  let sec = 0; d.live.forEach(x => splitOf(x).forEach(p => { if (p.s === s.id) sec += p.sec; }));
  return { id: s.id, name: s.name, imp: s.imp || 2, diff: s.diff || 2, priority: s.priority || 2, estHours: s.estHours || null, studiedMin: sec / 60,
    concepts: cs.map(cn => { const i = d.cinfo[cn.id] || { state: 0, ix: d.EMPTY }; const p = i.ix.practice, n = sum(p.map(x => x.n)); const m = c.mem[cn.id];
      return { state: i.state, viaLecture: lecOpen(cn.id), imp: impOf(cn.id), acc: n ? sum(p.map(x => x.c)) / n : null, accN: n, S: m && m.S ? m.S : null }; }),
    lectures: lecs.map(l => { const pg = d.lecProg[l.id]; return { min: l.min || null, watched: pg.watch, studied: pg.study, done: pg.covered }; }),
    questions: d.questions.filter(q => questionSubject(q) === s.id).map(q => ({ S: (c.qmem[q.id] || {}).S || null })),
    openMistakes: openMistakes().filter(m => (m.sid || d.subjOf[m.cid]) === s.id).map(m => ({ stage: m.stage || 0 })) };
}
/** Everything the roadmap, forecast and dashboards need, computed once per data change. */
function model() {
  const d = derive(); if (d.model) return d.model;
  const c = core(), S = c.settings, P = c.prep, A = c.availability;
  const ex = activeExam(), cal = d.cal, dl = daysLeft();
  const start = ex && ex.startDate && ex.startDate < cal ? ex.startDate : (ex && ex.startDate) || cal;
  const phases = ex && ex.date && isDateKey(ex.date) ? buildPhases(start <= cal ? start : cal, ex.date) : [];
  const phase = phaseOn(phases, cal);
  const mixes = normMix(S.mix), mixKey = phase ? phase.mixKey : examPhase(dl);
  const cap = ex && ex.date && dl != null && dl > 0 ? capacity(cal, ex.date, A, { extraPerDay: extraPerDay(), todayKey: cal, studiedTodayMin: studiedSec() / 60 }) : { total: 0, days: 0, studyDays: 0, weekdayStudyDays: 0, weekendStudyDays: 0, restDays: 0, perDay: [] };
  const subs = examSubjects(false);
  const work = estimateWork(subs.map(subjectWorkInput), { daysLeft: dl == null ? 180 : Math.max(0, dl), prep: P, minPerReview: S.minPerReview });
  const feas = assessFeasibility({ work, cap, av: A, daysLeft: dl, subjects: subs.map(s => ({ id: s.id, name: s.name, imp: s.imp || 2, priority: s.priority || 2 })) });
  const shares = subjectShares(subs, work);
  const covEnd = coverageEnd(phases);
  const req = requiredLearnShare(work.learnMin, cap, covEnd);
  const days = cap.perDay.map(x => { const ph = phaseOn(phases, x.k); return { k: x.k, learn: x.min * learnShare(ph ? ph.key : null, req, mixes[ph ? ph.mixKey : 'middle']) }; });
  const r14 = sumRange(d.days, addDays(d.today, -13), d.today);
  const recentLearn = ((r14.mode.lecture || 0) + (r14.mode.reading || 0) + (r14.mode.notes || 0)) / 60 / 14;
  const forecast = phases.length ? forecastCompletion({ today: cal, learnRemainingMin: work.learnMin, days: cap.perDay, phases, base: mixes[mixKey], recentLearnMinPerDay: recentLearn }) : null;
  const order = subjectOrder(subs.map(s => ({ id: s.id, name: s.name, order: d.orderIdx[s.id], imp: s.imp || 2, priority: s.priority || 2, prereqSubjects: s.prereqSubjects || [] })));
  const learnMin = {}; work.subjects.forEach(w => { learnMin[w.id] = w.learnMin; });
  const prereq = {}; subs.forEach(s => { prereq[s.id] = s.prereqSubjects || []; });
  const timeline = subjectTimeline({ order, learnMin, weight: shares.dyn, prereq, days, parallel: P.subjectsPerDay.weekday || 0 });
  const subSet = new Set(subs.map(s => s.id));
  const lec = lectureStats(d.lectures.filter(l => subSet.has(l.subjectId)), d.today, { sh: d.sh, defaultMin: P.defaultLectureMin, baseline: c.roadmap, evidence: d.lecEvidence });
  const newShare = learnShare(phase ? phase.key : null, req, mixes[mixKey]);
  const mix = adaptMix(mixes[mixKey], mixKey === 'final' ? Math.min(newShare, mixes.final.new) : newShare);
  return d.model = { ex, dl, cal, phases, phase, mixKey, mix, cap, work, feas, forecast, order, timeline, lec, shares, days, covEnd, subs };
}
/** A plain-data picture of the syllabus and memory for the pure planner. */
function makeSnapshot() {
  const d = derive(), c = core(), S = c.settings, m = model();
  const subs = m.subs, subSet = new Set(subs.map(s => s.id));
  const cs = d.concepts.filter(cn => subSet.has(d.subjOf[cn.id]) && isLiveConcept(cn));
  const learned = {}, total = {}; cs.forEach(cn => { const sid = d.subjOf[cn.id]; total[sid] = (total[sid] || 0) + 1; if (d.cinfo[cn.id].state >= 1) learned[sid] = (learned[sid] || 0) + 1; });
  const wl = {}; m.work.subjects.forEach(w => { wl[w.id] = w.learnMin; });
  const exposure = {};
  for (let i = 0; i < 14; i++) { const k = addDays(d.today, -i), x = d.days[k]; if (x) { exposure[k] = {}; for (const sid in x.subj) exposure[k][sid] = x.subj[sid] / 60; } }
  const a = c.active; if (a) { const sid = sesSubject(a); if (sid) { const e = exposure[d.today] || (exposure[d.today] = {}); e[sid] = (e[sid] || 0) + focusNow(a) / 60; } }
  const lastStudied = {}; d.live.forEach(x => splitOf(x).forEach(p => { if (p.s) lastStudied[p.s] = dayKey(x.startedAt, d.sh); }));
  const startToday = dayStart(d.today, d.sh), before = d.live.filter(x => x.startedAt < startToday).slice(-1)[0];
  const lecOpen = cid => (d.lecOfC[cid] || []).some(l => !d.lecProg[l.id].covered);
  const since7 = d.now - 7 * DAY;
  return {
    now: d.now, today: d.today, sh: d.sh,
    subjects: subs.map(s => ({ id: s.id, name: s.name, order: d.orderIdx[s.id], imp: s.imp || 2, priority: s.priority || 2, share: m.shares.dyn[s.id] || 0,
      prereqSubjects: s.prereqSubjects || [], targetDate: s.targetDate || null, learnedFrac: total[s.id] ? (learned[s.id] || 0) / total[s.id] : 0, learnLeftMin: wl[s.id] || 0 })),
    concepts: cs.map(cn => { const i = d.cinfo[cn.id]; return { id: cn.id, sid: d.subjOf[cn.id], order: d.orderIdx[cn.id], name: cn.name, prereq: cn.prereq || [], imp: impOf(cn.id), state: i.state,
      mem: c.mem[cn.id] || null, practice: i.ix.practice.map(p => ({ n: p.n, c: p.c, at: p.at })), formula: !!(cn.formula || promptsFor(cn.id).some(p => p.kind === 'formula')),
      viaLecture: c.prep.mode === 'lectures' && lecOpen(cn.id), lapses: (c.mem[cn.id] || {}).lapses || 0 }; }),
    lectures: d.lectures.filter(l => subSet.has(l.subjectId)).map(l => { const pg = d.lecProg[l.id]; return { id: l.id, sid: l.subjectId, order: l.order, label: d.lecLab[l.id].label, min: l.min || null,
      cids: (l.conceptIds || []).filter(x => d.byId[x]), watched: pg.watch, studied: pg.study, recalled: pg.recall, done: pg.covered, watchedAt: l.watchedAt || null }; }),
    mistakes: openMistakes().map(x => ({ id: x.id, cid: x.cid || null, sid: x.sid || d.subjOf[x.cid] || null, next: x.next, stage: x.stage || 0 })),
    questions: d.questions.filter(q => { const sid = questionSubject(q); return !sid || subSet.has(sid); }).map(q => ({ id: q.id, sid: questionSubject(q), cid: q.conceptId || null, mem: c.qmem[q.id] || null,
      recentWrong: (d.qAtt[q.id] || []).some(x => x.result === 'incorrect' && x.at >= since7) })),
    exposure, lastStudied, lastStudyGapDays: before ? daysBetween(dayKey(before.startedAt, d.sh), d.today) : 0,
    weights: S.weights, minPerReview: S.minPerReview, memOpts: { retention: S.retention, sh: d.sh, maxIvl: maxIvlNow() }
  };
}
/* Kept for the Review view, badges and the coach: the same candidate lists the planner uses. */
function planCtx(minutes) {
  const d = derive(), S = core().settings, snap = makeSnapshot();
  const C = candidates(snap, d.today, {});
  return { minutes, daysLeft: daysLeft(), mix: normMix(S.mix), minPerReview: S.minPerReview, due: C.due, newCands: C.newCands, practiceCands: C.practiceCands,
    mistakesDue: C.mistakesDue, cumulativeCands: C.cumulativeCands, formulaCands: C.formulaCands, lastStudyGapDays: snap.lastStudyGapDays, deficit: C.deficit };
}
function normMix(mix) {
  const out = {};
  for (const p in mix) { const t = sum(Object.values(mix[p]).map(v => Math.max(0, +v || 0))) || 1; out[p] = {}; for (const k in mix[p]) out[p][k] = Math.max(0, +mix[p][k] || 0) / t; }
  return out;
}
function firstDayKey() { const d = derive(); const ks = Object.keys(d.days).sort(); return ks.length ? ks[0] : d.today; }
function studiedSec(k) { const d = derive(); const x = d.days[k || d.today]; let sec = x ? x.sec : 0; const a = core().active; if (a && (!k || k === d.today)) sec += focusNow(a); return sec; }
function nowMinOfDay() { const t = new Date(); return t.getHours() * 60 + t.getMinutes(); }
/** Options for building one day. Today starts from the current time; future days use the kept tasks pinned to them. */
function dayOptsFor(k, isToday, minutes, keep) {
  const c = core(), m = model(), ex = m.ex;
  const ph = phaseOn(m.phases, k), mixes = normMix(c.settings.mix), mk = ph ? ph.mixKey : m.mixKey;
  const dl = ex && ex.date ? daysBetween(k, ex.date) : null;
  const mix = mk === m.mixKey ? m.mix : adaptMix(mixes[mk], learnShare(ph ? ph.key : null, requiredLearnShare(m.work.learnMin, m.cap, m.covEnd), mixes[mk]));
  return { minutes, windows: windowsOn(k), fromMin: isToday ? nowMinOfDay() + 5 : null, phase: ph, mixKey: mk, mix, daysLeft: dl, prep: c.prep,
    subjectsPerDay: subjectsPerDayOn(k), minSession: c.availability.minSession, keep: keep || [], id: uid };
}
/** A finished day's plan, with every task in full, for missed-day checks, the weekly review and the progress file's day records. */
function planHistorySummary(p) {
  const tasks = (p.blocks || []).filter(b => b.kind !== 'break').map(b => {
    const t = { kind: b.kind, min: b.min, status: b.status === 'skipped' ? 'skipped' : blockDoneIn(p, b) ? 'done' : 'todo', subjectId: b.subjectId || null, lectureId: b.lectureId || null,
      key: b.key, title: b.title, start: b.start || null, end: b.end || null, why: (b.why || []).slice(0, 4) };
    if (b.locked) t.locked = true; if (b.manual) t.manual = true; if (b.fromDay) t.fromDay = b.fromDay;
    const pr = Math.round((p.progress || {})[b.key] || 0); if (pr && t.status !== 'done') t.progressMin = pr;
    return t;
  });
  return { date: p.date, plannedMin: sum(tasks.filter(t => t.status !== 'skipped').map(t => t.min)), doneMin: sum(tasks.filter(t => t.status === 'done').map(t => t.min)),
    studiedMin: Math.round(studiedSec(p.date) / 60), avail: p.avail, notes: (p.notes || []).slice(0, 6), tasks };
}
/** When a new day starts: yesterday's plan goes to history (for missed-day checks and the weekly review). */
function rolloverPlans() {
  const c = core(), d = derive(); let changed = false;
  if (c.plan && c.plan.date && c.plan.date < d.today) { c.planHistory[c.plan.date] = planHistorySummary(c.plan); c.plan = null; changed = true; }
  // tasks you moved to a day that has passed without opening the app still count as planned (and not done) that day
  for (const k of Object.keys(c.dayPlans || {})) if (k < d.today) { if (!c.planHistory[k] && (c.dayPlans[k].blocks || []).length) c.planHistory[k] = planHistorySummary(Object.assign({ progress: {} }, c.dayPlans[k], { date: k })); delete c.dayPlans[k]; changed = true; }
  const keys = Object.keys(c.planHistory).sort(); if (keys.length > 400) { keys.slice(0, keys.length - 400).forEach(k => delete c.planHistory[k]); changed = true; }
  if (changed) Store.touch('core');
}
function missedInfo() {
  const d = derive(), c = core(); const studied = {};
  for (const k in d.days) studied[k] = d.days[k].sec / 60;
  const since = Object.keys(c.planHistory).sort()[0] || firstDayKey();
  return detectMissed({ today: d.today, history: c.planHistory, studiedMin: studied, av: c.availability, since, lookback: 14 });
}
function ensurePlan(force, avail) {
  const c = core(), d = derive();
  rolloverPlans();
  if (!force && c.plan && c.plan.date === d.today && avail == null) return c.plan;
  const same = c.plan && c.plan.date === d.today;
  const A = avail != null ? avail : same ? c.plan.avail : (availOn(d.today) || c.settings.avail || c.settings.dailyMin);
  const studied = Math.round(studiedSec() / 60);
  let keep = same ? keepOnRegenerate(c.plan.blocks || [], b => blockDoneIn(c.plan, b)) : [];
  if (!same && c.dayPlans[d.today]) { keep = keepOnRegenerate(c.dayPlans[d.today].blocks || [], () => false); delete c.dayPlans[d.today]; }
  const missed = !same ? missedInfo() : { streak: 0 };
  const res = buildDay(makeSnapshot(), d.today, Object.assign(dayOptsFor(d.today, true, Math.max(0, A - studied), keep), { recoveryDays: missed.streak || 0 }));
  const progress = {}; if (same) for (const b of res.tasks) if (c.plan.progress[b.key] != null) progress[b.key] = c.plan.progress[b.key];
  c.plan = { date: d.today, avail: A, base: studied, phase: res.phase, roadmapPhase: (model().phase || {}).key || null, notes: res.notes, blocks: res.tasks,
    progress, done: {}, subjects: res.subjects, generatedAt: Date.now() };
  if (same && c.plan.prevMinutes == null) c.plan.prevMinutes = 0;
  Store.touch('core');
  return c.plan;
}
/** The coming days, planned on a simulated copy of your data (today comes from the saved plan). Not saved. */
function projectWeek(n) {
  const d = derive(), c = core(); ensurePlan(false);
  const snap = makeSnapshot();
  const first = addDays(d.today, 1);
  const days = projectDays(snap, first, Math.max(0, (n || 7) - 1), k => dayOptsFor(k, false, availOn(k), keepOnRegenerate(((c.dayPlans || {})[k] || {}).blocks || [], () => false)));
  return [{ date: d.today, tasks: c.plan.blocks, notes: c.plan.notes || [], subjects: c.plan.subjects || [], today: true }].concat(days);
}
/** Saves the current roadmap as the baseline that progress is compared against ("Re-plan from today"). */
function rebaseline() {
  const c = core(), m = model(), d = derive();
  const lecBySub = {}; d.lectures.filter(l => !d.lecProg[l.id].covered).forEach(l => (lecBySub[l.subjectId] || (lecBySub[l.subjectId] = [])).push(l.id));
  const ld = lectureDates(lecBySub, m.timeline.rows, m.days);
  d.lectures.filter(l => d.lecProg[l.id].covered).forEach(l => { ld[l.id] = dayKey(d.lecProg[l.id].completedAt || d.now, d.sh); });
  const subjects = {}; for (const id in m.timeline.rows) subjects[id] = { start: m.timeline.rows[id].start, end: m.timeline.rows[id].end };
  c.roadmap = { at: Date.now(), examDate: m.ex && m.ex.date || null, subjects, lectures: ld, coverageEnd: m.covEnd, requiredMin: m.feas.requiredMin, availableMin: m.feas.availableMin };
  Store.touch('core');
}
function blockDoneIn(p, b) { return !!(p && b && (b.status === 'done' || (p.done || {})[b.key] || (p.progress[b.key] || 0) >= b.min * 0.8)); }
function blockDone(b) { return blockDoneIn(core().plan, b); }

/* ---------------- timer (time always derived from timestamps) ---------------- */
function focusNow(a, t) { t = t || Date.now(); return Math.max(0, (t - a.startedAt) / 1000 - (a.pausedSec || 0) - (a.pausedAt ? (t - a.pausedAt) / 1000 : 0) - (a.idleSec || 0)); }
function beat() { try { localStorage.setItem(LS + 'beat', JSON.stringify({ id: (core().active || {}).id, t: Date.now() })); } catch (e) { } lastBeatWrite = Date.now(); }
let lastBeatWrite = 0, lastTick = Date.now();
function startSession(f) {
  const c = core(); if (c.active) return;
  const st = STYLES.find(x => x[0] === f.style) || STYLES[0];
  const mins = st[0] === 'stopwatch' || st[0] === 'pomodoro' ? 0 : (parseFloat(f.minutes) || st[2]);
  const a = { id: uid('ss'), examId: f.examId || (activeExam() || {}).id || null, subjectId: f.subjectId || null, topicId: f.topicId || null, subtopicId: f.subtopicId || null,
    conceptIds: (f.conceptIds || []).slice(0, 40), mode: f.mode || 'mixed', style: st[0], targetSec: mins ? Math.round(mins * 60) : null,
    startedAt: Date.now(), pausedAt: null, pauseReason: null, pausedSec: 0, breakSec: 0, idleSec: 0, confBefore: f.confBefore || null, goal: f.goal || '', blockKey: f.blockKey || null, notes: '',
    lectureId: f.lectureId || null, taskId: f.taskId || null, taskKind: f.taskKind || null, qids: (f.qids || []).slice(0, 60) };
  if (st[0] === 'pomodoro') { const P = c.settings.pomo; a.pomo = { focus: P.focus, brk: P.brk, long: P.longBrk, every: P.every, cycle: 1, phase: 'focus', mark: 0 }; }
  c.active = a; beat(); Store.touch('core', true);
  if (st[0] === 'deep' || st[0] === 'mock') ui.focus = true;
  render();
}
function pauseSession(reason) {
  const a = core().active; if (!a || a.pausedAt) return;
  a.pausedAt = Date.now(); a.pauseReason = reason || 'pause'; a.breakNotified = false;
  Store.touch('core', true); renderDock(); renderFocus();
}
function resumeSession() {
  const a = core().active; if (!a || !a.pausedAt) return;
  const dt = (Date.now() - a.pausedAt) / 1000; a.pausedSec += dt; if (a.pauseReason === 'break') a.breakSec += dt;
  a.pausedAt = null; a.pauseReason = null;
  if (a.pomo && a.pomo.phase === 'break') { a.pomo.phase = 'focus'; a.pomo.cycle++; a.pomo.mark = focusNow(a); }
  beat(); Store.touch('core', true); renderDock(); renderFocus();
}
function stopSession(at) {
  const c = core(), a = c.active; if (!a) return null;
  const t = Math.min(Date.now(), Math.max(a.startedAt + 1000, at || Date.now()));
  if (a.pausedAt) { const dt = Math.max(0, (Math.min(t, Date.now()) - a.pausedAt) / 1000); a.pausedSec += dt; if (a.pauseReason === 'break') a.breakSec += dt; a.pausedAt = null; }
  const focus = Math.round(focusNow(a, t));
  const d = derive();
  const s = { id: a.id, examId: a.examId, subjectId: a.subjectId, topicId: a.topicId, subtopicId: a.subtopicId, conceptIds: a.conceptIds.slice(),
    startedAt: a.startedAt, endedAt: t, elapsedSec: Math.round((t - a.startedAt) / 1000), pausedSec: Math.round(a.pausedSec), breakSec: Math.round(a.breakSec), idleExcludedSec: Math.round(a.idleSec),
    focusSec: focus, mode: a.mode, timerStyle: a.style, targetSec: a.targetSec, source: 'timer', confidenceBefore: a.confBefore, notes: a.notes || '', goal: a.goal || '',
    planBlock: a.blockKey, taskId: a.taskId || null, lectureId: a.lectureId || null, taskKind: a.taskKind || null, qids: a.qids || [],
    selfReportedSec: a.selfReportedSec || null, status: a.targetSec && focus >= a.targetSec ? 'completed' : 'stopped', createdAt: Date.now() };
  c.active = null;
  s.conceptIds.forEach(cid => { if (!c.mem[cid]) c.mem[cid] = { state: 'new', due: dayStart(addDays(d.today, 1), d.sh), reps: 0, lapses: 0, ok: 0, fail: 0 }; });
  if (a.blockKey && c.plan && c.plan.date === d.today) c.plan.progress[a.blockKey] = (c.plan.progress[a.blockKey] || 0) + focus / 60;
  saveSession(s, true); Store.touch('core', true);
  try { localStorage.removeItem(LS + 'beat'); } catch (e) { }
  document.title = 'Logbook PrepOS';
  return s;
}
function chime() {
  try {
    const ctx = chime.ctx || (chime.ctx = new (window.AudioContext || window.webkitAudioContext)());
    [0, 0.2].forEach((dl, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = i ? 880 : 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + dl); g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + dl + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dl + 0.5); o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + dl); o.stop(ctx.currentTime + dl + 0.55);
    });
  } catch (e) { }
}
function idleGapCheck(fromTs, reason) {
  const a = core().active; if (!a || a.pausedAt) return;
  const gap = Date.now() - Math.max(fromTs, a.startedAt);
  if (gap >= core().settings.idleMin * MIN && !(ui.modal && ui.modal.type === 'idle')) {
    ui.modal = { type: 'idle', from: Math.max(fromTs, a.startedAt), gapSec: Math.round(gap / 1000), reason }; renderModal();
  }
}
function resumeCheck() {
  const a = core().active; if (!a) return;
  let b = null; try { b = JSON.parse(localStorage.getItem(LS + 'beat') || 'null'); } catch (e) { }
  if (b && b.id === a.id) idleGapCheck(b.t, 'closed');
  else if (!a.pausedAt && focusNow(a) > 4 * 3600) { ui.modal = { type: 'idle', from: null, gapSec: Math.round(focusNow(a)), reason: 'long' }; renderModal(); }
}
function tick() {
  const t = Date.now(), c = core(), a = c.active;
  if (a) {
    if (!a.pausedAt) {
      if (t - lastTick > 60000) idleGapCheck(lastTick, 'sleep');
      const f = focusNow(a, t);
      if (a.pomo && a.pomo.phase === 'focus' && f - a.pomo.mark >= a.pomo.focus * 60) {
        a.pomo.phase = 'break'; a.pomo.breakLen = (a.pomo.cycle % a.pomo.every === 0 ? a.pomo.long : a.pomo.brk);
        pauseSession('break'); chime(); toast('Focus block done. Take a ' + a.pomo.breakLen + '-minute break.');
      }
      if (a.targetSec && !a.targetHit && f >= a.targetSec) {
        a.targetHit = true; chime(); Store.touch('core');
        if (a.style === 'mock') { const s = stopSession(); ui.focus = false; openPost(s); }
        else { ui.modal = { type: 'target' }; renderModal(); }
      }
      if (t - lastBeatWrite > 15000) beat();
    } else if (a.pauseReason === 'break' && a.pomo && !a.breakNotified && (t - a.pausedAt) / 1000 >= (a.pomo.breakLen || 5) * 60) {
      a.breakNotified = true; chime(); toast('Break over. Resume when you are ready.');
    }
  }
  lastTick = t;
  updateClocks();
}

/* ---------------- AI (server route) and downloads ---------------- */
const CAP = { ai: 'off', dl: true };
function setAIStatus() { const el = $('#ai-status'); if (el) el.textContent = CAP.ai === 'on' ? 'AI coach available' : 'AI features off (no API key)'; }
const aiOn = () => CAP.ai === 'on';
function aiErr(e) {
  const code = e && e.code;
  if (code === 'not_granted') { CAP.ai = 'off'; setAIStatus(); return 'AI features are not configured on this server. Everything else keeps working.'; }
  if (code === 'rate_limited') return 'Too many AI requests right now. Try again in a little while.';
  if (code === 'session_expired') return 'You were signed out. Sign in again to use AI features.';
  if (code === 'cancelled') return '';
  if (code === 'invalid_json') return 'The AI reply could not be read. Try again.';
  return (e && e.message) ? 'The AI request did not complete: ' + e.message : 'The AI request did not complete. Try again.';
}
function aiFail(status, message) {
  const code = status === 501 ? 'not_granted' : status === 401 ? 'session_expired' : status === 429 ? 'rate_limited' : 'failed';
  return { code, message };
}
const toTurns = input => typeof input === 'string' ? [{ role: 'user', content: input }] : input;
async function aiText(input, opts) {
  opts = opts || {};
  let text = '';
  try {
    const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: toTurns(input) }), signal: opts.signal });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw aiFail(r.status, j.error); }
    const reader = r.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const delta = dec.decode(value, { stream: true }); text += delta;
      if (opts.onText) opts.onText({ text, delta });
    }
    return { text, truncated: false };
  } catch (e) {
    if (e && e.name === 'AbortError') throw { code: 'cancelled', text };
    if (e && e.code) throw Object.assign(e, { text });
    throw { code: 'failed', message: 'network error', text };
  }
}
async function aiJson(input) {
  const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: toTurns(input), json: true }) }).catch(() => null);
  if (!r) throw { code: 'failed', message: 'network error' };
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw aiFail(r.status, j.error);
  const raw = String(j.text || '').replace(/```json|```/g, '').trim();
  const start = raw.search(/[\[{]/);
  try { return JSON.parse(start > 0 ? raw.slice(start) : raw); } catch (e) { throw { code: 'invalid_json' }; }
}

/* ---------------- small UI helpers ---------------- */
let toastT = null;
function toast(msg) { const el = $('#toast'); if (!el) return; el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200); }
const fmtDay = k => keyToDate(k).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayLong = k => keyToDate(k).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtTime = ts => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const fmtDate = ts => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
function relDue(ts) {
  const d = derive(); const k = dayKey(ts, d.sh); const n = daysBetween(d.today, k);
  if (n < 0) return plural(-n, 'day') + ' overdue'; if (n === 0) return 'today'; if (n === 1) return 'tomorrow'; if (n < 7) return 'in ' + n + ' days'; return fmtDay(k);
}
function toLocalInput(ts) { const d = new Date(ts); return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

/* =====================================================================
   UI STATE, SHELL, SHARED WIDGETS
   ===================================================================== */
const ui = {
  view: 'today', param: null, modal: null, focus: false, rev: null, lastDay: null,
  subj: { exam: 'active', showArch: false, tab: 'syllabus', listTab: 'list' },
  hist: { subj: '', mode: '', src: '', from: '', to: '', q: '', showDiscarded: false },
  cal: { month: null, sel: null, tab: 'study' },
  ins: { range: 'week', from: '', to: '' },
  mis: { filter: 'due', type: '' },
  coach: { msgs: [], busy: false, ctl: null },
  revOpt: { subj: '', mixed: true, count: 20 }
};
const NAV = [['today', 'Today'], ['plan', 'Plan'], ['review', 'Review'], ['practice', 'Practice'], ['subjects', 'Subjects'], ['lectures', 'Lectures'], ['mistakes', 'Mistakes'],
  ['week', 'Weekly review'], ['history', 'History'], ['calendar', 'Calendar'], ['insights', 'Insights'], ['coach', 'Coach'], ['method', 'Method'], ['settings', 'Settings']];
const HIDDEN_VIEWS = ['subject', 'setup', 'welcome'];
const ICO = {
  today: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  review: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/></svg>',
  subjects: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 5h14M5 12h14M5 19h9"/></svg>',
  more: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>'
};

const stateTag = st => `<span class="state s${st}">${STATES[st]}</span>`;
const dot = color => `<span class="dot" style="background:${color}"></span>`;
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
const chip = (label, on, attrs) => `<button type="button" class="chip" aria-pressed="${on ? 'true' : 'false'}" ${attrs}>${label}</button>`;
function scaleHTML(k, v, act) { return `<div class="scale" role="group">${[1, 2, 3, 4, 5].map(n => `<button type="button" aria-pressed="${v === n}" data-a="${act || 'fscale'}" data-k="${k}" data-v="${n}">${n}</button>`).join('')}</div>`; }
function hbar(label, color, val, max, right, planFrac) {
  const w = max ? Math.min(100, val / max * 100) : 0;
  return `<div class="hbar"><span class="lbl">${color ? dot(color) : ''}${label}</span><span class="track"><i style="width:${w}%;background:${color || 'var(--blue)'}"></i>${planFrac != null ? `<span class="plan" style="left:${Math.min(99.5, planFrac * 100)}%" title="Planned share"></span>` : ''}</span><span class="v">${right}</span></div>`;
}
function stat(v, label, cls) { return `<div class="stat"><b class="${cls || ''}">${v}</b><span>${label}</span></div>`; }
function conceptNames(cids, n) {
  const names = (cids || []).map(id => N(id)).filter(Boolean).map(x => x.name);
  if (!names.length) return '';
  const k = n || 3; return names.slice(0, k).join(', ') + (names.length > k ? ' and ' + (names.length - k) + ' more' : '');
}
function sesCrumb(s) {
  const parts = [];
  if (s.topicId && N(s.topicId)) parts.push(N(s.topicId).name);
  if (s.subtopicId && N(s.subtopicId)) parts.push(N(s.subtopicId).name);
  let crumb = parts.join(' › ');
  const cn = conceptNames(s.conceptIds, 2);
  if (cn) crumb = crumb ? crumb + ': ' + cn : cn;
  return crumb;
}
function sesSubject(s) {
  if (s.subjectId) return s.subjectId;
  const d = derive(); const subs = [...new Set((s.conceptIds || []).map(c => d.subjOf[c]).filter(Boolean))];
  return subs.length === 1 ? subs[0] : null;
}
function sesLabel(s) { const sid = sesSubject(s); return sid ? subjName(sid) : ((s.conceptIds || []).length ? 'Mixed subjects' : 'Study session'); }
function srcTags(s) {
  let t = s.source === 'manual' ? '<span class="tag manual">Manual, self-reported</span>' : s.source === 'imported' ? '<span class="tag manual">Imported</span>' : '<span class="tag timer">Timer</span>';
  if (s.timeEdited) t += ' <span class="tag edited">Time corrected</span>'; else if (s.edited) t += ' <span class="tag edited">Edited</span>';
  if (s.status === 'discarded') t += ' <span class="tag red">Discarded</span>';
  if (s.selfReportedSec && s.source === 'timer' && Math.abs(s.selfReportedSec - s.focusSec) >= 300) t += ` <span class="tag">You said ${fmtDur(s.selfReportedSec)}</span>`;
  return t;
}
function maxIvlNow() { const S = core().settings, dl = daysLeft(); if (dl == null || !S.capToExam || dl < 1) return 3650; return Math.max(1, dl > 10 ? dl - 5 : dl - 1); }
function memOpts(cid) { const S = core().settings; return { retention: Memory.targetRetention(S.retention, impOf(cid)), sh: S.dayStartHour, maxIvl: maxIvlNow(), fuzz: true }; }
function liveConcepts() { const d = derive(); const set = new Set(examSubjects(false).map(s => s.id)); return d.concepts.filter(cn => set.has(d.subjOf[cn.id]) && isLiveConcept(cn)); }
function riskList() {
  const d = derive(), c = core();
  return liveConcepts().filter(cn => { const m = c.mem[cn.id], R = d.cinfo[cn.id].R; return m && m.S && ((R != null && R < 0.75) || (m.lapses || 0) >= 2); })
    .sort((a, b) => (d.cinfo[a.id].R ?? 1) - (d.cinfo[b.id].R ?? 1));
}
function dueCount() { return planCtx(0).due.length; }
function misDue() { const d = derive(); const end = dayStart(addDays(d.today, 1), d.sh); return d.mistakes.filter(m => !m.resolved && m.next < end); }
function greeting() { const h = new Date().getHours(); return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
let skipHash = null;
function go(view, param) {
  const h = '#' + view + (param ? '/' + param : '');
  if (location.hash !== h) { skipHash = h; location.hash = h; }
  routeFromHash(); if (ui.modal && ui.modal.type === 'more') ui.modal = null; renderNav(); renderMain(); renderModal();
}
function routeFromHash() {
  const h = (location.hash || '#today').slice(1).split('/');
  ui.view = NAV.some(n => n[0] === h[0]) || HIDDEN_VIEWS.includes(h[0]) ? h[0] : 'today';
  ui.param = h[1] || null;
}

/* ---------------- render shell ---------------- */
let lastView = null;
function render() { renderNav(); renderDock(); renderMain(); renderModal(); renderFocus(); updateClocks(); setSaveStatus(); setAIStatus(); }
function renderNav() {
  const cur = ui.view === 'subject' ? 'subjects' : ui.view;
  let due = 0, mdue = 0;
  try { due = dueCount(); mdue = misDue().length; } catch (e) { }
  let qdue = 0; try { qdue = PREP.questionsDueCount(); } catch (e) { }
  const badge = { review: due, mistakes: mdue, practice: qdue };
  $('#rail-links').innerHTML = NAV.map(([k, name]) => `<a href="#${k}"${cur === k ? ' aria-current="page"' : ''}>${name}${badge[k] ? `<span class="badge">${badge[k]}</span>` : ''}</a>`).join('');
  const a = core().active;
  const rs = $('#rail-start');
  if (rs) { rs.textContent = a ? 'Session running' : 'Start study session'; rs.className = 'btn start ' + (a ? 'live' : 'primary'); rs.dataset.a = a ? 'focus-open' : 'start-open'; }
  const inMore = !['today', 'plan', 'review'].includes(cur);
  $('#tabbar').innerHTML = `
    <a href="#today"${cur === 'today' ? ' aria-current="page"' : ''}>${ICO.today}Today</a>
    <a href="#plan"${cur === 'plan' ? ' aria-current="page"' : ''}>${ICO.subjects}Plan</a>
    ${a ? `<button class="go on" data-a="focus-open" aria-label="Open running timer"><span id="tab-time">${fmtClock(focusNow(a))}</span></button>` : `<button class="go" data-a="start-open">Start</button>`}
    <a href="#review"${cur === 'review' ? ' aria-current="page"' : ''}>${ICO.review}Review${due ? ' ' + due : ''}</a>
    <button data-a="more-open"${inMore ? ' aria-current="page"' : ''}>${ICO.more}More</button>`;
}
function renderMain() {
  const m = $('#main');
  const needsSetup = !core().prep.setupDone && !derive().subjects.length;
  let view = ui.view;
  if (needsSetup && !['setup', 'settings', 'method'].includes(view)) view = 'welcome';
  const fn = { today: PREP.viewDashboard, plan: PREP.viewPlan, practice: PREP.viewPractice, lectures: PREP.viewLectures, week: PREP.viewWeek, setup: PREP.viewWizard, welcome: PREP.viewWelcome,
    review: viewReview, subjects: viewSubjects, subject: viewSubject, mistakes: viewMistakes, history: viewHistory, calendar: viewCalendar, insights: viewInsights, coach: viewCoach, method: viewMethod, settings: viewSettings }[view] || PREP.viewDashboard;
  const y = window.scrollY;
  try { m.innerHTML = `<div id="storage-banner">${PREP.storageBanner(saveStatusInfo())}</div>` + fn(); }
  catch (e) { console.error(e); m.innerHTML = `<div class="empty"><h2>Something went wrong on this page</h2><p class="muted">${esc(e && e.message)}</p><button class="btn" data-a="nav" data-v="today">Back to Today</button></div>`; }
  const key = ui.view + '/' + (ui.param || '');
  if (key !== lastView) { window.scrollTo(0, 0); lastView = key; } else window.scrollTo(0, y);
  if (ui.view === 'coach') { const box = $('#chat-end'); if (box) box.scrollIntoView({ block: 'end' }); }
}
function renderDock() {
  const a = core().active, el = $('#dock');
  if (!a) { el.innerHTML = ''; return; }
  const sid = sesSubject(a);
  el.innerHTML = `<div class="dock${a.pausedAt ? ' paused' : ''}" role="region" aria-label="Running session">
    <span class="led" aria-hidden="true"></span>
    <div class="path"><b>${esc(sid ? subjName(sid) : sesLabel(a))}</b><span>${esc(sesCrumb(a) || MODE_NAME[a.mode])}${a.pausedAt ? (a.pauseReason === 'break' ? ', on a break' : ', paused') : ''}</span></div>
    <span class="clock" id="dock-time" aria-label="Focused time">${fmtClock(focusNow(a))}</span>
    <div class="row">${a.pausedAt ? '<button class="btn sm live" data-a="resume">Resume</button>' : '<button class="btn sm" data-a="pause">Pause</button>'}
      <button class="btn sm stop" data-a="stop">Stop session</button><button class="btn sm ghost" data-a="focus-open">Focus view</button></div></div>`;
}
function phaseText(a, f) {
  if (a.pausedAt) {
    if (a.pauseReason === 'break' && a.pomo) { const left = a.pomo.breakLen * 60 - (Date.now() - a.pausedAt) / 1000; return left > 0 ? 'Break: ' + fmtClock(left).slice(3) + ' left' : 'Break over. Resume when ready.'; }
    return 'Paused. Paused time does not count as study time.';
  }
  if (a.pomo) { const left = a.pomo.focus * 60 - (f - a.pomo.mark); return 'Pomodoro ' + a.pomo.cycle + ': ' + fmtClock(Math.max(0, left)).slice(3) + ' until a break'; }
  if (a.targetSec) {
    if (a.style === 'mock') return 'Mock exam: time remaining. Elapsed ' + fmtDur(f);
    return f >= a.targetSec ? 'Target of ' + fmtDur(a.targetSec) + ' reached. Keep going or stop.' : 'Target ' + fmtDur(a.targetSec) + ': ' + fmtDur(a.targetSec - f) + ' to go';
  }
  return MODE_NAME[a.mode] + ', stopwatch';
}
function renderFocus() {
  const root = $('#focus-root'), a = core().active;
  if (!a || !ui.focus) { root.innerHTML = ''; return; }
  const sid = sesSubject(a);
  root.innerHTML = `<div class="focus" role="dialog" aria-label="Focus view">
    <div class="ftop"><span class="muted">${esc(MODE_NAME[a.mode])}, ${esc(STYLE_NAME[a.style]).toLowerCase()}</span>
      <div class="row"><button class="btn sm ghost" data-a="fullscreen">Full screen</button><button class="btn sm ghost" data-a="focus-close">Exit focus view</button></div></div>
    <div class="center"><div class="subject">${esc(sid ? subjName(sid) : sesLabel(a))}</div><div class="crumb">${esc(sesCrumb(a))}</div>
      <div class="big" id="focus-time">${fmtClock(focusNow(a))}</div><div class="phase" id="focus-phase">${esc(phaseText(a, focusNow(a)))}</div>
      ${a.targetSec ? '<div class="progress bar"><i id="focus-bar" style="width:0"></i></div>' : ''}</div>
    <div class="fbot">${a.pausedAt ? '<button class="btn lg live" data-a="resume">Resume</button>' : '<button class="btn lg" data-a="pause">Pause</button>'}<button class="btn lg stop" data-a="stop">Stop session</button></div>
    <div class="hints"><kbd>P</kbd> pause or resume &nbsp; <kbd>F</kbd> focus view &nbsp; <kbd>Esc</kbd> exit</div></div>`;
}
function updateClocks() {
  const a = core().active;
  const set = (id, v) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
  if (a) {
    const f = focusNow(a);
    set('dock-time', fmtClock(f));
    set('focus-time', a.style === 'mock' && a.targetSec ? fmtClock(Math.max(0, a.targetSec - f)) : fmtClock(f));
    set('focus-phase', phaseText(a, f));
    set('tab-time', fmtClock(f));
    const bar = document.getElementById('focus-bar'); if (bar && a.targetSec) bar.style.width = Math.min(100, f / a.targetSec * 100) + '%';
    document.title = (a.pausedAt ? 'Paused ' : '') + fmtClock(f) + ', ' + (sesSubject(a) ? subjName(sesSubject(a)) : 'studying');
  }
  const lt = document.querySelectorAll('.live-today');
  if (lt.length) { const v = fmtDur(studiedSec()); lt.forEach(el => { if (el.textContent !== v) el.textContent = v; }); }
}

/* =====================================================================
   TODAY
   ===================================================================== */
function todayLearning() {
  const d = derive(), k = d.today;
  const rv = d.reviews.filter(r => dayKey(r.at, d.sh) === k);
  const ses = d.live.filter(s => dayKey(s.startedAt, d.sh) === k);
  const pr = d.practice.filter(p => dayKey(p.at, d.sh) === k && !p.ses);
  const newC = new Set();
  ses.forEach(s => (s.conceptIds || []).forEach(cid => { const ix = d.I[cid]; if (ix && ix.sessions[0] && dayKey(ix.sessions[0].startedAt, d.sh) === k) newC.add(cid); }));
  const q = sum(ses.map(s => s.questionsSolved || 0)) + sum(pr.map(p => p.n)), qc = sum(ses.map(s => s.questionsCorrect || 0)) + sum(pr.map(p => p.c));
  return { reviews: rv.length, reviewOk: rv.filter(r => r.g >= 2).length, newConcepts: newC.size, q, qc, sessions: ses };
}
function planBlockSub(b) {
  if (b.kind === 'break') return 'Step away from the screen.';
  if (b.kind === 'mistakes') return plural(b.mids.length, 'mistake') + ' due for retry';
  const names = conceptNames(b.cids, 3);
  if (b.kind === 'practice' && b.interleaved) return 'Interleaved: ' + names;
  return names || (b.kind === 'cumulative' ? 'Older concepts across subjects' : '');
}
function sesRow(s) {
  const sid = sesSubject(s);
  return `<div class="li clickable" data-a="ses-edit" data-id="${s.id}"><span class="dot" style="background:${sid ? subjColor(sid) : 'var(--faint)'}"></span>
    <div class="grow"><div class="title">${esc(sesLabel(s))}</div><div class="sub">${fmtTime(s.startedAt)}–${fmtTime(s.endedAt)}, ${esc(MODE_NAME[s.mode] || s.mode)}${sesCrumb(s) ? ', ' + esc(sesCrumb(s)) : ''}</div></div>
    <span class="small">${srcTags(s)}</span><b class="num" style="font-size:20px;min-width:64px;text-align:right">${fmtDur(s.focusSec)}</b></div>`;
}
function blockStart(key) {
  const c = core(), p = c.plan; const b = p && p.blocks.find(x => x.key === key); if (!b) return;
  const d = derive(); const subs = [...new Set(b.cids.map(x => d.subjOf[x]).filter(Boolean))];
  const sid = b.subjectId || (subs.length === 1 ? subs[0] : null);
  const link = { blockKey: b.key, taskId: b.id || null, taskKind: b.kind, lectureId: b.lectureId || null };
  if (b.kind === 'lecture' || b.kind === 'selfstudy') {
    const l = b.lectureId && d.lectures.find(x => x.id === b.lectureId);
    const f = Object.assign({ examId: (activeExam() || {}).id || '', subjectId: sid || (l && l.subjectId) || '', topicId: (l && l.topicId) || '', subtopicId: '', conceptIds: b.cids.slice(),
      mode: b.kind === 'lecture' ? 'lecture' : 'reading', style: 'focus', minutes: b.min }, link);
    if (f.subjectId && f.conceptIds.length) { const t = new Set(f.conceptIds.map(x => d.topicOf[x])); if (t.size === 1) f.topicId = [...t][0] || f.topicId; }
    openStart(f); return;
  }
  if (b.kind === 'recall') { PREP.openLectureRecall(b.lectureId, b.key); return; }
  if (b.kind === 'qreview') {
    const qids = (b.qids || []).filter(id => d.qById[id]);
    if (!qids.length) { toast('Those questions are no longer due. Mark this task done.'); return; }
    if (!c.active) startSession(Object.assign({ mode: 'practice', style: 'focus', minutes: b.min, conceptIds: [], subjectId: sid, qids }, link));
    PREP.beginQuestionReview(qids, { fromPlan: b.key }); go('practice'); return;
  }
  if (b.kind === 'review' || b.kind === 'cumulative') {
    if (!b.cids.length) { toast('Nothing to recall in this block. Mark it done.'); return; }
    if (!c.active) startSession(Object.assign({ mode: 'recall', style: 'focus', minutes: b.min, conceptIds: b.cids, subjectId: sid }, link));
    beginReview(b.cids, { mixed: true, fromPlan: true }); go('review'); return;
  }
  if (b.kind === 'mistakes') {
    if (!c.active) startSession(Object.assign({ mode: 'mistakes', style: 'focus', minutes: b.min, conceptIds: b.cids, subjectId: sid }, link));
    ui.mis.filter = 'due'; go('mistakes'); return;
  }
  const f = Object.assign({ examId: (activeExam() || {}).id || '', subjectId: sid || '', topicId: '', subtopicId: '', conceptIds: b.cids.slice(), mode: b.kind === 'practice' ? 'practice' : 'reading', style: 'focus', minutes: b.min }, link);
  if (sid && b.cids.length) { const t = new Set(b.cids.map(x => d.topicOf[x])); if (t.size === 1) f.topicId = [...t][0]; }
  openStart(f);
}

/* =====================================================================
   REVIEW (active recall)
   ===================================================================== */
function orderInterleaved(items) {
  const bySub = {}; items.forEach(it => (bySub[it.sid] || (bySub[it.sid] = [])).push(it));
  const out = []; let more = true;
  while (more) { more = false; for (const k in bySub) if (bySub[k].length) { out.push(bySub[k].shift()); more = true; } }
  return out;
}
function beginReview(cids, o) {
  const d = derive();
  let q = cids.filter(id => d.byId[id]);
  if (o && o.mixed && q.length > 2) q = orderInterleaved(q.map(cid => ({ cid, sid: d.subjOf[cid] }))).map(x => x.cid);
  ui.rev = { queue: q, i: 0, results: [], again: {}, mixed: !!(o && o.mixed), fromPlan: !!(o && o.fromPlan), phase: 'prompt' };
  nextCard(true);
}
function pickPrompt(cid) {
  const ps = promptsFor(cid);
  if (ps.length) { const p = ps.slice().sort((a, b) => (a.lastAt || 0) - (b.lastAt || 0))[0]; return Object.assign({}, p); }
  const n = N(cid);
  return { id: null, kind: 'free', q: `Without looking: explain ${n.name}. State the key idea, the main rule or formula, and one situation where you would use it.`, a: '' };
}
function nextCard(first) {
  const r = ui.rev; if (!r) return;
  if (!first) r.i++;
  if (r.i >= r.queue.length) { r.phase = 'done'; return; }
  const cid = r.queue[r.i];
  Object.assign(r, { phase: 'prompt', cid, prompt: pickPrompt(cid), shownAt: Date.now(), revealedAt: null, hint: false, showHint: false, outcome: null, conf: null, answer: '' });
}
function answerFor(cid, p) {
  const n = N(cid); const parts = [];
  if (p.a) parts.push(p.a);
  if (!p.a && n.formula) parts.push(n.formula);
  if (!p.a && n.notes) parts.push(n.notes);
  return parts.join('\n\n');
}
function viewReview() {
  const r = ui.rev;
  if (r && r.phase !== 'done' && r.queue.length) return viewCard();
  if (r && r.phase === 'done') return viewReviewDone();
  const d = derive(), ctx = planCtx(0), o = ui.revOpt;
  const subsWithDue = [...new Set(ctx.due.map(x => x.sid))];
  const list = ctx.due.filter(x => !o.subj || x.sid === o.subj);
  const overdue = ctx.due.filter(x => x.overdue).length, critical = ctx.due.filter(x => x.critical).length;
  const recent = liveConcepts().filter(cn => d.cinfo[cn.id].state >= 1 && !ctx.due.some(x => x.cid === cn.id)).sort((a, b) => ((d.cinfo[b.id].ix.sessions.slice(-1)[0] || {}).startedAt || 0) - ((d.cinfo[a.id].ix.sessions.slice(-1)[0] || {}).startedAt || 0)).slice(0, 8);
  return `<div class="page-head"><div><h1>Review</h1><p>Hide the material, recall it, then check. Each result updates when you see the concept next. Intervals adapt to your answers rather than following a fixed 1-3-7 pattern.</p></div></div>
  <div class="panel"><div class="debt">${stat(ctx.due.length, 'Due today')}${stat(overdue, 'Overdue')}${stat(critical, 'Critical')}
    <p class="small muted">${ctx.due.length ? 'Critical means overdue and either at high risk, high importance, or a prerequisite for what you are learning now.' : 'Nothing is due. You can still recall recently studied concepts below.'}</p></div></div>
  ${ctx.due.length ? `<section class="block"><div class="spread"><h2>Start a review</h2></div>
    <div class="stack"><div class="chips">${chip('All subjects', !o.subj, 'data-a="rev-subj" data-v=""')}${subsWithDue.map(sid => chip(dot(subjColor(sid)) + esc(subjName(sid)) + ' ' + ctx.due.filter(x => x.sid === sid).length, o.subj === sid, `data-a="rev-subj" data-v="${sid}"`)).join('')}</div>
    <div class="row">${chip('Mix subjects (interleave)', o.mixed, 'data-a="rev-mixed"')}
      <select data-c="rev-count" style="width:auto">${[5, 10, 20, 40, 999].map(n => opt(n, n === 999 ? 'All ' + list.length : n + ' cards', o.count)).join('')}</select>
      <button class="btn primary" data-a="rev-go">Start review of ${Math.min(list.length, o.count)}</button></div>
    <p class="small muted">${core().active ? 'Your running session keeps timing while you review.' : 'A recall timer starts with the review so the time is counted.'}</p></div></section>` : ''}
  ${list.length ? `<section class="block"><h2 style="margin-bottom:10px">Due, most urgent first</h2><div class="list">${list.slice(0, 60).map(x => {
    const cn = N(x.cid), m = core().mem[x.cid];
    return `<div class="li clickable" data-a="concept" data-id="${x.cid}">${dot(subjColor(x.sid))}<div class="grow"><div class="title">${esc(cn.name)}</div><div class="sub">${esc(pathStr(x.cid).split(' › ').slice(0, -1).join(' › '))}</div></div>
      ${x.critical ? '<span class="tag red">Critical</span>' : ''}<span class="small muted">${m.S ? 'Est. recall ' + pct(x.R) : 'First recall'}</span><span class="small">${relDue(m.due)}</span></div>`; }).join('')}</div></section>` : ''}
  ${recent.length ? `<section class="block"><div class="spread"><h2>Recall something studied recently</h2><button class="btn sm" data-a="rev-recent">Recall these ${recent.length}</button></div>
    <p class="small muted" style="margin-bottom:8px">Recalling before a concept is due is fine. Same-day repeats are logged but never stretch the interval.</p>
    <div class="chips">${recent.map(cn => `<button class="chip" data-a="concept" data-id="${cn.id}">${dot(subjColor(d.subjOf[cn.id]))}${esc(cn.name)}</button>`).join('')}</div></section>` : ''}`;
}
function viewCard() {
  const r = ui.rev, cid = r.cid, n = N(cid), d = derive();
  if (!n) { nextCard(); return viewReview(); }
  const p = r.prompt, m = core().mem[cid];
  const hide = r.mixed && ['problem', 'application'].includes(p.kind) && r.phase === 'prompt';
  const head = `<div class="spread"><span class="small muted">Card ${r.i + 1} of ${r.queue.length}${r.again[cid] ? ', again' : ''}</span><div class="row"><span class="tag">${esc(PK_NAME[p.kind] || 'Recall')}</span><button class="btn sm ghost" data-a="rev-quit">End review</button></div></div>`;
  const where = hide ? '<div class="small muted">Mixed practice: decide which concept this uses before you reveal.</div>' : `<div class="row small">${dot(subjColor(d.subjOf[cid]))}<span class="muted">${esc(pathStr(cid).split(' › ').slice(0, -1).join(' › '))}</span></div><h2>${esc(n.name)}</h2>`;
  if (r.phase === 'recover') return head + viewRecover();
  if (r.phase === 'prompt') {
    return `${head}<div class="card" style="margin-top:14px">${where}<div class="prompt">${esc(p.q)}</div>
      <div><div class="sheet-label">Before you check: how sure are you? (optional)</div>${scaleHTML('conf', r.conf, 'rev-conf')}</div>
      <label class="f">Your answer (optional; writing it out makes the check honest)<textarea id="rev-answer" data-c="rev-answer" placeholder="Recall from memory. No peeking.">${esc(r.answer)}</textarea></label>
      ${p.hint ? (r.showHint ? `<div class="note">Hint: ${esc(p.hint)}</div>` : '<div><button class="btn sm ghost" data-a="rev-hint">Show a hint (counts as help)</button></div>') : ''}
      <div class="row"><button class="btn primary lg" data-a="rev-reveal">Reveal answer</button><span class="small muted kbd-hint"><kbd>Space</kbd> reveals</span></div></div>`;
  }
  const rt = Math.round(((r.revealedAt || Date.now()) - r.shownAt) / 1000);
  const ans = answerFor(cid, p);
  const pv = Memory.preview(m && m.S ? m : null, Date.now(), memOpts(cid));
  const sug = Memory.suggestGrade({ outcome: r.outcome, hint: r.hint, rtSec: rt, conf: r.conf });
  const lab = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
  const help = { 1: 'Could not recall', 2: 'Recalled with effort or help', 3: 'Recalled correctly', 4: 'Instant and certain' };
  return `${head}<div class="card" style="margin-top:14px">${hide ? '' : where}${hide ? `<div class="row small">${dot(subjColor(d.subjOf[cid]))}<span class="muted">This was: <b>${esc(n.name)}</b>, ${esc(pathStr(cid).split(' › ').slice(0, -1).join(' › '))}</span></div>` : ''}
    <div class="prompt">${esc(p.q)}</div>
    ${r.answer ? `<div><div class="sheet-label">What you wrote</div><div style="white-space:pre-wrap">${esc(r.answer)}</div></div>` : ''}
    <div><div class="sheet-label">Answer</div><div class="answer">${ans ? esc(ans) : '<span class="muted">No answer stored yet. Compare with your notes or source, then judge honestly. Add a recall prompt with an answer so the next check is instant.</span>'}</div></div>
    <div><div class="sheet-label">How did it go?</div><div class="chips">${[['correct', 'Correct'], ['partial', 'Partly correct'], ['incorrect', 'Incorrect']].map(([k, l]) => chip(l, r.outcome === k, `data-a="rev-out" data-v="${k}"`)).join('')}</div>
      <p class="tiny muted" style="margin-top:6px">Took ${rt}s${r.hint ? ', hint used' : ''}${r.conf ? ', confidence ' + r.conf + ' of 5' : ''}. The outlined button is a suggestion from these signals.</p></div>
    <div class="grades">${[1, 2, 3, 4].map(g => `<button data-a="rev-grade" data-v="${g}" class="${g === sug ? 'sug' : ''}"><span>${g} ${lab[g]}</span><small>${help[g]}</small><small>Next: ${pv[g] === 1 ? 'tomorrow' : 'in ' + plural(pv[g], 'day')}</small></button>`).join('')}</div></div>`;
}
function gradeCard(g) {
  const r = ui.rev, c = core(), now = Date.now(), cid = r.cid;
  const rt = Math.round(((r.revealedAt || now) - r.shownAt) / 1000);
  const d0 = derive(), due0 = c.mem[cid] && c.mem[cid].due;
  const od = due0 ? Math.max(0, daysBetween(dayKey(due0, d0.sh), dayKey(now, d0.sh))) : 0;
  const res = Memory.apply(c.mem[cid] || null, g, now, memOpts(cid));
  c.mem[cid] = res.m;
  addReview({ id: uid('r'), at: now, cid, g, o: r.outcome || (g === 1 ? 'incorrect' : g === 2 ? 'partial' : 'correct'), hint: r.hint, rt, cf: r.conf, R: res.R, ivl: res.ivl, pk: r.prompt.kind, pid: r.prompt.id, ses: (c.active || {}).id || null, same: res.sameDay, od });
  if (r.prompt.id) { const ps = promptsFor(cid).map(p => p.id === r.prompt.id ? Object.assign({}, p, { lastAt: now }) : p); setPrompts(cid, ps); }
  Store.touch('core');
  r.results.push({ cid, g, ivl: res.ivl, o: r.outcome });
  if (g === 1 && (r.again[cid] || 0) < 2) { r.again[cid] = (r.again[cid] || 0) + 1; r.queue.push(cid); }
  const recent = derive().cinfo[cid] ? derive().cinfo[cid].ix.reviews.slice(-4) : [];
  if (g === 1 && ((res.m.lapses || 0) >= 2 || recent.filter(x => x.g === 1).length >= 2)) { r.phase = 'recover'; r.recoverCid = cid; r.reexplain = ''; return; }
  nextCard();
}
function viewRecover() {
  const r = ui.rev, cid = r.recoverCid, n = N(cid), d = derive();
  const pre = (n.prereq || []).map(id => N(id)).filter(Boolean);
  return `<div class="card" style="margin-top:14px"><h2>This one keeps slipping</h2>
    <p>${esc(n.name)} has been forgotten more than once. Repeating it harder rarely helps. Work through these steps instead:</p>
    <ol class="small" style="margin:0;padding-left:20px;display:grid;gap:4px"><li>Check the prerequisites below. A shaky foundation is a common cause.</li><li>Re-read or re-explain the idea in simpler terms.</li><li>Do an easy recall now (it is back in this review).</li><li>A moderate recall comes back tomorrow; the scheduler has shortened the interval.</li><li>Then apply it: a basic problem first, then a standard one.</li></ol>
    ${pre.length ? `<div><div class="sheet-label">Prerequisites</div><div class="list">${pre.map(p => `<div class="li"><div class="grow"><div class="title">${esc(p.name)}</div><div class="sub">${esc(pathStr(p.id).split(' › ').slice(0, -1).join(' › '))}</div></div>${stateTag(d.cinfo[p.id] ? d.cinfo[p.id].state : 0)}<span class="small muted">${d.cinfo[p.id] && d.cinfo[p.id].R != null ? 'Est. recall ' + pct(d.cinfo[p.id].R) : 'Not reviewed yet'}</span></div>`).join('')}</div>
      <div style="margin-top:8px"><button class="btn sm" data-a="rev-prereq">Recall the prerequisites next</button></div></div>` : '<p class="small muted">No prerequisites are linked. You can link them from the concept page (Related tab).</p>'}
    ${aiOn() ? `<div><button class="btn sm" data-a="rev-reexplain"${r.reexplainBusy ? ' disabled' : ''}>${r.reexplainBusy ? 'Thinking…' : 'Explain it simply with AI'}</button></div>${r.reexplain ? `<div class="answer" id="reexplain">${esc(r.reexplain)}</div>` : '<div id="reexplain"></div>'}` : ''}
    ${n.notes || n.formula ? `<div><div class="sheet-label">Your notes</div><div class="answer">${esc([n.formula, n.notes].filter(Boolean).join('\n\n'))}</div></div>` : ''}
    <div class="row"><button class="btn primary" data-a="rev-continue">Continue the review</button><button class="btn" data-a="concept" data-id="${cid}" data-tab="prompts">Add an easier prompt</button><button class="btn ghost" data-a="concept" data-id="${cid}" data-tab="practice">Log practice</button></div></div>`;
}
function viewReviewDone() {
  const r = ui.rev, res = r.results;
  const uniq = {}; res.forEach(x => uniq[x.cid] = x);
  const final = Object.values(uniq);
  const ok = res.filter(x => x.g >= 2).length;
  const a = core().active;
  const soon = final.slice().sort((x, y) => x.ivl - y.ivl);
  return `<div class="page-head"><div><h1>Review done</h1><p>${plural(final.length, 'concept')} recalled, ${res.length ? Math.round(ok / res.length * 100) : 0}% of attempts successful. Each one is scheduled for when you are likely to start forgetting it.</p></div></div>
    ${a && ['recall', 'mistakes'].includes(a.mode) ? `<div class="note blue spread"><span>Your ${MODE_NAME[a.mode].toLowerCase()} timer is still running (${fmtDur(focusNow(a))}).</span><button class="btn sm stop" data-a="stop">Stop and save</button></div>` : ''}
    <section class="block"><div class="list">${soon.map(x => `<div class="li clickable" data-a="concept" data-id="${x.cid}"><div class="grow"><div class="title">${esc((N(x.cid) || {}).name || 'Removed')}</div></div><span class="small">${['', 'Again', 'Hard', 'Good', 'Easy'][x.g]}</span><span class="small muted">next ${x.ivl === 1 ? 'tomorrow' : 'in ' + plural(x.ivl, 'day')}</span></div>`).join('')}</div></section>
    <div class="row" style="margin-top:20px"><button class="btn primary" data-a="rev-close">Back to review</button><a class="btn" href="#today">Today</a></div>`;
}

/* =====================================================================
   SUBJECTS + ROADMAP
   ===================================================================== */
function subjStats(sid) {
  const d = derive(), c = core();
  const sn = N(sid), cs = conceptsUnder(sid).filter(cn => !d.archivedChain[cn.id] || (sn && sn.archived));
  const info = cn => d.cinfo[cn.id] || { state: 0, mastery: { value: null }, R: null, m: null };
  const states = cs.map(cn => info(cn).state);
  const ms = cs.map(cn => info(cn).mastery.value).filter(v => v != null);
  let sec = 0, n = 0;
  d.live.forEach(s => { let hit = false; splitOf(s).forEach(p => { if (p.s === sid) { sec += p.sec; hit = true; } }); if (hit) n++; });
  const end = dayStart(addDays(d.today, 1), d.sh);
  const due = cs.filter(cn => c.mem[cn.id] && c.mem[cn.id].due < end);
  const weak = cs.filter(cn => { const i = info(cn); const ps = i.ix ? practiceSignal({ practice: i.ix.practice, recall: i.R, state: i.state }) : null;
    return (i.mastery.value != null && i.mastery.value < 0.5) || (i.m && (i.m.lapses || 0) >= 2) || (i.R != null && i.R < 0.6) || (ps && ps.signal === 'weak-application'); });
  return { cs, states, mastery: ms.length ? sum(ms) / ms.length : null, masteryN: ms.length, sec, n, due, weak,
    started: states.filter(s => s >= 1).length, retrieved: states.filter(s => s >= 3).length, stable: states.filter(s => s >= 6).length, mastered: states.filter(s => s >= 7).length,
    topics: (d.kids[sid] || []).filter(k => k.kind === 'topic').length };
}
function progBar(st) {
  const t = st.cs.length || 1;
  return `<div class="bar" title="Started, retrieved, stable"><i style="width:${st.started / t * 100}%;background:var(--rule)"></i><i style="width:${st.retrieved / t * 100}%;background:var(--blue)"></i><i style="width:${st.stable / t * 100}%;background:var(--live)"></i></div>`;
}
function examTags(s) { const c = core(); return (s.examIds || []).map(id => c.exams.find(e => e.id === id)).filter(Boolean).map(e => `<span class="tag">${esc(e.name)}</span>`).join(' '); }
function viewSubjects() {
  const d = derive(), c = core(), o = ui.subj;
  const exFilter = o.exam === 'active' ? (activeExam() || {}).id || '' : o.exam;
  const all = examSubjects(true, exFilter || null);
  const shown = all.filter(s => o.showArch || !s.archived);
  const archN = all.filter(s => s.archived).length;
  const head = `<div class="page-head"><div><h1>Subjects</h1><p>Exam, subject, topic, subtopic, concept. Add as much or as little structure as you know; a subject alone is enough to plan with. One subject can belong to several exams.</p></div>
    <div class="row"><button class="btn" data-a="import-open">Import syllabus</button><button class="btn primary" data-a="subj-add">Add subject</button></div></div>
    <div class="tabs" role="tablist"><button role="tab" aria-selected="${o.listTab === 'list'}" data-a="subj-listtab" data-v="list">Subjects</button><button role="tab" aria-selected="${o.listTab === 'roadmap'}" data-a="subj-listtab" data-v="roadmap">Roadmap</button></div>`;
  if (o.listTab === 'roadmap') return head + PREP.viewSubjectRoadmap();
  const chips = `<div class="chips" style="margin-bottom:14px">${chip('All exams', !exFilter, 'data-a="subj-exam" data-v=""')}${c.exams.filter(e => !e.archived).map(e => chip(esc(e.name), exFilter === e.id, `data-a="subj-exam" data-v="${e.id}"`)).join('')}${archN ? chip('Show archived (' + archN + ')', o.showArch, 'data-a="subj-arch"') : ''}</div>`;
  if (!shown.length) return head + chips + `<div class="empty"><p>No subjects for this exam yet.</p><button class="btn primary" data-a="subj-add">Add subject</button></div>`;
  const rows = shown.map(s => {
    const st = subjStats(s.id);
    return `<div class="li"><span class="dot" style="background:${s.color || 'var(--faint)'}"></span>
      <div class="grow clickable" data-a="nav" data-v="subject/${s.id}"><div class="title">${esc(s.name)} ${s.archived ? '<span class="tag">Archived</span>' : ''} ${examTags(s)}</div>
        <div class="sub">${plural(st.topics, 'topic')}, ${plural(st.cs.length, 'concept')}: ${st.started} started, ${st.retrieved} retrieved, ${st.stable} stable${st.due.length ? ', ' + st.due.length + ' due' : ''}</div>
        <div style="margin-top:6px;max-width:420px">${progBar(st)}</div></div>
      <div class="stat" style="text-align:right;min-width:92px"><b style="font-size:24px">${st.mastery == null ? '–' : pct(st.mastery)}</b><span>${st.mastery == null ? 'Mastery: too early' : 'Est. mastery, ' + st.masteryN + ' concepts'}</span></div>
      <div class="stat" style="text-align:right;min-width:72px"><b style="font-size:24px">${fmtDur(st.sec)}</b><span>studied</span></div>
      <div class="row" style="gap:0"><button class="iconbtn" data-a="node-move" data-id="${s.id}" data-v="-1" aria-label="Move up">Up</button><button class="iconbtn" data-a="node-move" data-id="${s.id}" data-v="1" aria-label="Move down">Down</button></div></div>`;
  }).join('');
  return head + chips + `<div class="panel tight"><div class="list">${rows}</div></div>
    <p class="tiny muted" style="margin-top:10px">Bar: grey started, blue retrieved at least once, green stable. Estimated mastery averages only concepts with enough evidence and is an estimate, not a grade.</p>`;
}
function viewSubject() {
  const d = derive(), s = d.byId[ui.param];
  if (!s) return `<div class="empty"><p>This subject no longer exists.</p><a class="btn" href="#subjects">All subjects</a></div>`;
  const st = subjStats(s.id), tab = ui.subj.tab;
  const tabs = [['syllabus', 'Syllabus'], ['lectures', 'Lectures'], ['questions', 'Questions'], ['resources', 'Resources'], ['time', 'Time'], ['weak', 'Weak and strong'], ['history', 'History']];
  let body = '';
  if (tab === 'syllabus') body = syllabusTree(s);
  else if (tab === 'lectures') body = PREP.subjectLecturesHTML(s.id);
  else if (tab === 'questions') body = PREP.subjectQuestionsHTML(s.id);
  else if (tab === 'resources') {
    const topics = (d.kids[s.id] || []).filter(t => t.kind === 'topic' && !t.archived);
    body = `<div class="panel stack">${PREP.resourcesHTML({ kind: 'subject', id: s.id })}</div>
      ${topics.length ? `<div class="stack" style="margin-top:14px">${topics.map(t => { const k = (core().resources || []).filter(r => !r.gone && (r.on || []).some(o => o.kind === 'topic' && o.id === t.id)).length; return `<details class="panel tight"${k ? ' open' : ''}><summary>${esc(t.name)} (${k})</summary><div style="margin-top:10px">${PREP.resourcesHTML({ kind: 'topic', id: t.id })}</div></details>`; }).join('')}</div>` : ''}
      <p class="tiny muted" style="margin-top:8px">Concept resources are in each concept's dialog; lecture resources in the lecture's dialog.</p>`;
  }
  else if (tab === 'time') {
    const tt = {}; d.live.forEach(x => splitOf(x).forEach(p => { if (p.s === s.id) { if (p.t) tt[p.t] = (tt[p.t] || 0) + p.sec; if (p.u) tt[p.u] = (tt[p.u] || 0) + p.sec; if (!p.t && !p.u) tt._ = (tt._ || 0) + p.sec; } }));
    const topics = (d.kids[s.id] || []).filter(t => t.kind === 'topic');
    const mx = Math.max(1, ...Object.values(tt));
    body = `<div class="panel">${topics.map(t => hbar(esc(t.name), s.color, tt[t.id] || 0, mx, fmtDur(tt[t.id] || 0)) + (d.kids[t.id] || []).filter(u => u.kind === 'subtopic' && tt[u.id]).map(u => hbar('<span class="muted">› ' + esc(u.name) + '</span>', s.color, tt[u.id], mx, fmtDur(tt[u.id]))).join('')).join('')}
      ${tt._ ? hbar('<span class="muted">Whole subject, no topic</span>', 'var(--faint)', tt._, mx, fmtDur(tt._)) : ''}</div>
      <p class="tiny muted" style="margin-top:8px">Sessions that cover several concepts split their time evenly between them.</p>`;
  } else if (tab === 'weak') {
    const lst = (arr, empty) => arr.length ? `<div class="list">${arr.map(cn => `<div class="li clickable" data-a="concept" data-id="${cn.id}"><div class="grow"><div class="title">${esc(cn.name)}</div><div class="sub">${esc(pathStr(cn.id, 1).split(' › ').slice(0, -1).join(' › '))}</div></div>${stateTag(d.cinfo[cn.id].state)}<span class="small muted">${d.cinfo[cn.id].R != null ? 'Est. recall ' + pct(d.cinfo[cn.id].R) : ''}</span></div>`).join('')}</div>` : `<p class="muted small">${empty}</p>`;
    const strong = st.cs.filter(cn => { const i = d.cinfo[cn.id]; return i && i.mastery.value != null && i.mastery.value >= 0.8 && i.state >= 5; });
    body = `<h3 style="margin-bottom:6px">Due for review</h3>${lst(st.due, 'Nothing due.')}<h3 style="margin:22px 0 6px">Weak</h3><p class="tiny muted">Low estimated mastery, low estimated recall, forgotten twice or more, or weak on practice questions.</p>${lst(st.weak, 'No weak concepts detected yet. That may just mean there is little evidence so far.')}
      <h3 style="margin:22px 0 6px">Strong</h3>${lst(strong, 'No concept is both applied and above 80% estimated mastery yet.')}`;
  } else {
    const ses = d.live.filter(x => splitOf(x).some(p => p.s === s.id)).slice(-60).reverse();
    body = ses.length ? `<div class="list">${ses.map(x => sesRowDated(x)).join('')}</div>` : '<p class="muted">No sessions yet.</p>';
  }
  return `<div class="page-head"><div><a href="#subjects" class="small">All subjects</a><h1 style="margin-top:6px">${dot(s.color)} ${esc(s.name)}</h1><p>${examTags(s) || 'Not linked to an exam'}${s.desc ? ' ' + esc(s.desc) : ''}</p></div>
    <div class="row"><button class="btn primary" data-a="start-subject" data-id="${s.id}">Start session</button><button class="btn" data-a="subj-edit" data-id="${s.id}">Edit</button>
      <button class="btn" data-a="node-archive" data-id="${s.id}">${s.archived ? 'Unarchive' : 'Archive'}</button><button class="btn danger" data-a="node-del" data-id="${s.id}">Delete</button></div></div>
    ${PREP.subjectDashboardHTML(s.id, st)}
    <section class="block"><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-a="subj-tab" data-v="${k}">${l}</button>`).join('')}</div>${body}</section>`;
}
function sesRowDated(s) {
  const sid = sesSubject(s);
  return `<div class="li clickable" data-a="ses-edit" data-id="${s.id}"><span class="dot" style="background:${sid ? subjColor(sid) : 'var(--faint)'}"></span><div class="grow"><div class="title">${fmtDate(s.startedAt)}, ${fmtTime(s.startedAt)}: ${esc(sesLabel(s))}</div><div class="sub">${esc(MODE_NAME[s.mode] || s.mode)}${sesCrumb(s) ? ', ' + esc(sesCrumb(s)) : ''}</div></div><span class="small">${srcTags(s)}</span><b class="num" style="font-size:19px;min-width:60px;text-align:right">${fmtDur(s.focusSec)}</b></div>`;
}
function conceptRow(cn) {
  const d = derive(), i = d.cinfo[cn.id] || { state: 0, R: null, m: null }, m = core().mem[cn.id];
  return `<div class="li clickable" data-a="concept" data-id="${cn.id}" style="padding:7px 2px${cn.archived ? ';opacity:.5' : ''}"><div class="grow"><div class="title" style="font-weight:400">${esc(cn.name)}${(cn.prereq || []).length ? ' <span class="tiny muted">(' + cn.prereq.length + ' prereq)</span>' : ''}</div></div>
    ${stateTag(i.state)}<span class="small muted" style="min-width:92px;text-align:right">${i.R != null ? 'Recall ' + pct(i.R) : ''}</span><span class="small muted" style="min-width:96px;text-align:right">${m && m.due ? relDue(m.due) : ''}</span></div>`;
}
function nodeTools(n) {
  const add = n.kind === 'topic' ? `<button class="iconbtn" data-a="node-add" data-kind="concept" data-id="${n.id}">+ Concept</button><button class="iconbtn" data-a="node-add" data-kind="subtopic" data-id="${n.id}">+ Subtopic</button>` : n.kind === 'subtopic' ? `<button class="iconbtn" data-a="node-add" data-kind="concept" data-id="${n.id}">+ Concept</button>` : '';
  return `<div class="row" style="gap:0">${add}<button class="iconbtn" data-a="node-edit" data-id="${n.id}">Rename</button><button class="iconbtn" data-a="node-move" data-id="${n.id}" data-v="-1" aria-label="Move up">Up</button><button class="iconbtn" data-a="node-move" data-id="${n.id}" data-v="1" aria-label="Move down">Down</button><button class="iconbtn" data-a="node-archive" data-id="${n.id}">${n.archived ? 'Unarchive' : 'Archive'}</button><button class="iconbtn" data-a="node-del" data-id="${n.id}">Delete</button></div>`;
}
function syllabusTree(s) {
  const d = derive();
  const topics = (d.kids[s.id] || []).filter(t => t.kind === 'topic');
  const tt = t => { const cs = conceptsUnder(t.id); return topicStatus(cs.map(cn => (d.cinfo[cn.id] || { state: 0 }).state)); };
  const html = topics.map(t => {
    const kids = d.kids[t.id] || [];
    const direct = kids.filter(k => k.kind === 'concept'), subs = kids.filter(k => k.kind === 'subtopic');
    return `<div class="t-topic"${t.archived ? ' style="opacity:.55"' : ''}><div class="spread"><div><b>${esc(t.name)}</b> <span class="tag">${tt(t)}</span> ${t.archived ? '<span class="tag">Archived</span>' : ''}</div>${nodeTools(t)}</div>
      <div class="list">${direct.map(conceptRow).join('')}</div>
      ${subs.map(u => `<div class="t-sub"><div class="spread"><span>${esc(u.name)}</span>${nodeTools(u)}</div><div class="list">${(d.kids[u.id] || []).filter(k => k.kind === 'concept').map(conceptRow).join('') || '<div class="li small muted">No concepts yet</div>'}</div></div>`).join('')}
      ${!direct.length && !subs.length ? '<p class="small muted" style="padding:6px 0">No concepts yet. Break the topic into ideas you could be asked to recall.</p>' : ''}</div>`;
  }).join('');
  return `<div class="tree">${html || '<p class="muted">No topics yet.</p>'}</div>
    <div class="row" style="margin-top:22px"><input type="text" id="new-topic" placeholder="New topic name" style="max-width:320px" data-enter="topic-add" data-id="${s.id}"><button class="btn" data-a="topic-add" data-id="${s.id}">Add topic</button></div>`;
}
/* Reorders subjects to the roadmap order: prerequisites first, then priority and importance. */
function applyRoadmapOrder() {
  const order = model().order, pos = new Map(order.map((id, i) => [id, i]));
  const subs = core().nodes.filter(n => n.kind === 'subject');
  subs.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e3 + (a.order || 0)) - (pos.has(b.id) ? pos.get(b.id) : 1e3 + (b.order || 0))).forEach((s, i) => s.order = i);
  Store.touch('core'); toast('Subjects reordered.');
}

/* =====================================================================
   CONCEPT PAGE (modal)
   ===================================================================== */
function stabilityLabel(S) { if (!S) return 'Not yet measured'; if (S < 3) return 'Fragile'; if (S < 10) return 'Building'; if (S < 30) return 'Solid'; return 'Strong'; }
function modalConcept() {
  const M = ui.modal, id = M.id, n = N(id), d = derive(), c = core();
  if (!n) return { html: '<p>This concept no longer exists.</p><div class="actions"><button class="btn" data-a="close">Close</button></div>' };
  const i = d.cinfo[id] || { ix: d.EMPTY, m: c.mem[id], mastery: { value: null, evidence: 0 }, state: 0, R: null };
  const ix = i.ix, m = c.mem[id] || null;
  const lastS = ix.sessions.slice(-1)[0], lastR = ix.reviews.slice(-1)[0];
  const okR = ix.reviews.filter(r => r.g >= 2).length, badR = ix.reviews.filter(r => r.g === 1).length;
  const f = M.f || (M.f = {});
  const tab = M.tab || 'prompts';
  const tabs = [['prompts', 'Recall prompts'], ['practice', 'Practice'], ['teach', 'Teach-back'], ['history', 'History'], ['mistakes', 'Mistakes'], ['resources', 'Resources'], ['related', 'Related'], ['notes', 'Notes and edit']];
  let body = '';
  if (tab === 'prompts') {
    const ps = promptsFor(id);
    body = `<p class="small muted">Recall prompts are the questions you will be asked in reviews. Mix kinds: free recall, formulas, explanations, comparisons, applications and problems.</p>
      <div class="list">${ps.map(p => `<div class="li" style="align-items:flex-start"><span class="tag">${esc(PK_NAME[p.kind] || p.kind)}</span><div class="grow"><div class="title" style="white-space:normal">${esc(p.q)}</div><div class="small muted" style="white-space:pre-wrap">${esc(p.a || 'No answer stored')}</div></div><button class="iconbtn" data-a="pr-del" data-pid="${p.id}">Remove</button></div>`).join('') || '<div class="li small muted">No prompts yet. Reviews will use a generic "explain it" prompt.</div>'}</div>
      <div class="panel stack" style="margin-top:12px"><div class="grid2"><label class="f">Kind<select data-c="fv" data-k="pk">${PROMPT_KINDS.map(k => opt(k[0], k[1], f.pk || 'free')).join('')}</select></label><label class="f">Hint (optional)<input type="text" data-c="fv" data-k="ph" value="${esc(f.ph || '')}"></label></div>
        <label class="f">Question<textarea data-c="fv" data-k="pq" style="min-height:60px">${esc(f.pq || '')}</textarea></label>
        <label class="f">Answer<textarea data-c="fv" data-k="pa" style="min-height:60px">${esc(f.pa || '')}</textarea></label>
        <div class="row"><button class="btn primary sm" data-a="pr-add">Add prompt</button>${aiOn() ? `<button class="btn sm" data-a="pr-ai"${M.busy ? ' disabled' : ''}>${M.busy ? 'Drafting…' : 'Draft prompts with AI'}</button>` : ''}</div>
        ${M.aiErr ? `<p class="small" style="color:var(--red)">${esc(M.aiErr)}</p>` : ''}
        ${(M.drafts || []).length ? `<div class="sheet-label">AI drafts: check each before adding</div><div class="list">${M.drafts.map((p, k) => `<div class="li" style="align-items:flex-start"><span class="tag">${esc(PK_NAME[p.kind] || p.kind)}</span><div class="grow"><div class="title" style="white-space:normal">${esc(p.q)}</div><div class="small muted" style="white-space:pre-wrap">${esc(p.a)}</div></div><button class="btn sm" data-a="pr-draft-add" data-v="${k}">Add</button></div>`).join('')}</div>` : ''}</div>`;
  } else if (tab === 'practice') {
    const pr = ix.practice.slice().reverse();
    const byLv = {}; ix.practice.forEach(p => { const b = byLv[p.lv] || (byLv[p.lv] = [0, 0]); b[0] += p.n; b[1] += p.c; });
    body = `<p class="small muted">Question-led learning climbs from simple recall to basic, standard, advanced and unfamiliar problems. Accuracy on harder levels counts more toward estimated mastery.</p>
      <div class="row small" style="margin:6px 0 12px">${LEVELS.map(([k, l]) => byLv[k] ? `<span class="tag">${l}: ${byLv[k][1]} of ${byLv[k][0]}</span>` : '').join(' ') || '<span class="muted">No attempts logged yet.</span>'}</div>
      <div class="panel stack"><div class="grid3"><label class="f">Level<select data-c="fv" data-k="lv">${LEVELS.map(l => opt(l[0], l[1], f.lv || 'standard')).join('')}</select></label>
        <label class="f">Questions tried<input type="number" min="1" data-c="fv" data-k="pn" value="${esc(f.pn || '')}"></label><label class="f">Correct<input type="number" min="0" data-c="fv" data-k="pc" value="${esc(f.pc || '')}"></label></div>
        <div class="grid2"><label class="f">Minutes (optional)<input type="number" min="0" data-c="fv" data-k="pmin" value="${esc(f.pmin || '')}"></label><label class="f">Source (optional)<input type="text" data-c="fv" data-k="psrc" placeholder="Previous paper, workbook, test series…" value="${esc(f.psrc || '')}"></label></div>
        <div><button class="btn primary sm" data-a="pa-add">Log practice</button></div></div>
      <div class="list" style="margin-top:10px">${pr.map(p => `<div class="li"><div class="grow"><div class="title" style="font-weight:400">${p.c} of ${p.n} correct, ${esc((LEVELS.find(l => l[0] === p.lv) || [0, p.lv])[1])}</div><div class="sub">${fmtDate(p.at)}${p.min ? ', ' + p.min + ' min' : ''}${p.src ? ', ' + esc(p.src) : ''}</div></div></div>`).join('')}</div>`;
    body = PREP.conceptQuestionsHTML(id) + body;
  } else if (tab === 'teach') {
    const tb = ix.teach.slice().reverse(); const res = M.tbRes;
    body = `<p class="small muted">Explain the concept as if teaching a friend, without notes. Explaining why and how is one of the better-supported ways to find gaps.</p>
      <label class="f">Your explanation<textarea id="tb-text" data-c="fv" data-k="tb" style="min-height:140px">${esc(f.tb || '')}</textarea></label>
      <div class="row">${aiOn() ? `<button class="btn primary sm" data-a="tb-ai"${M.busy ? ' disabled' : ''}>${M.busy ? 'Checking…' : 'Show me what I missed'}</button>` : ''}<span class="small muted">${aiOn() ? 'or rate yourself:' : 'Rate your own explanation:'}</span>
        ${[[90, 'Complete'], [70, 'Mostly'], [40, 'Partly'], [15, 'Could not']].map(([v, l]) => `<button class="chip" data-a="tb-self" data-v="${v}">${l}</button>`).join('')}</div>
      ${M.aiErr ? `<p class="small" style="color:var(--red)">${esc(M.aiErr)}</p>` : ''}
      ${res ? teachResHTML(res) : ''}
      ${tb.length ? `<div class="sheet-label" style="margin-top:14px">Earlier explanations</div><div class="list">${tb.map(t => `<div class="li" style="align-items:flex-start"><div class="grow"><div class="sub">${fmtDate(t.at)}, ${t.ai ? 'AI-checked' : 'self-rated'}: ${t.score}</div><div class="small" style="white-space:pre-wrap">${esc((t.text || '').slice(0, 280))}${(t.text || '').length > 280 ? '…' : ''}</div></div></div>`).join('')}</div>` : ''}`;
  } else if (tab === 'history') {
    const ev = [];
    ix.sessions.forEach(s => ev.push([s.startedAt, `Studied ${fmtDur(s.focusSec / Math.max(1, (s.conceptIds || []).length))}${(s.conceptIds || []).length > 1 ? ' (share of a ' + fmtDur(s.focusSec) + ' session)' : ''}, ${MODE_NAME[s.mode] || s.mode}`, s.source === 'manual' ? 'manual' : 'timer']));
    ix.reviews.forEach(r => ev.push([r.at, `Recall: ${['', 'Again', 'Hard', 'Good', 'Easy'][r.g]}${r.o ? ' (' + r.o + ')' : ''}${r.hint ? ', hint' : ''}${r.R != null ? ', est. recall was ' + pct(r.R) : ''}, next in ${plural(r.ivl, 'day')}`, 'rev']));
    ix.practice.forEach(p => ev.push([p.at, `Practice: ${p.c} of ${p.n} correct (${p.lv})`, 'pr']));
    ix.mistakes.forEach(x => ev.push([x.at, `Mistake logged: ${MT_NAME[x.type] || x.type}`, 'mis']));
    ix.teach.forEach(t => ev.push([t.at, `Teach-back: ${t.score}`, 'tb']));
    ev.sort((a, b) => b[0] - a[0]);
    const succ = ix.reviews.filter(r => r.g >= 2).map(r => fmtDate(r.at));
    const first = Math.min(...[ix.sessions[0] && ix.sessions[0].startedAt, ix.reviews[0] && ix.reviews[0].at].filter(Boolean));
    body = `<div class="panel tight grid2"><div><div class="sheet-label">Knowledge over time</div><p class="small">First studied: ${isFinite(first) ? fmtDate(first) : 'not yet'}<br>Successful recalls: ${succ.length ? esc(succ.join(', ')) : 'none yet'}<br>Current stability: ${stabilityLabel(m && m.S)}${m && m.S ? ' (about ' + Math.round(m.S) + ' days)' : ''}</p></div>
      <div><div class="sheet-label">Estimated mastery parts</div><p class="small">${i.mastery.comps && i.mastery.comps.length ? i.mastery.comps.map(x => x[0] + ' ' + pct(x[1])).join(', ') : 'Not enough evidence yet.'}</p></div></div>
      <div class="list" style="margin-top:10px">${ev.map(e => `<div class="li"><span class="small muted" style="min-width:120px">${fmtDate(e[0])}, ${fmtTime(e[0])}</span><div class="grow small">${esc(e[1])}</div>${e[2] === 'manual' ? '<span class="tag manual">Manual</span>' : ''}</div>`).join('') || '<div class="li muted">Nothing yet.</div>'}</div>`;
  } else if (tab === 'mistakes') {
    body = `<div class="spread"><p class="small muted">Mistakes tied to this concept come back for staged retries.</p><button class="btn sm" data-a="mis-add" data-cid="${id}">Log a mistake</button></div>
      <div class="list">${ix.mistakes.map(misRow).join('') || '<div class="li muted">None logged.</div>'}</div>`;
  } else if (tab === 'resources') {
    const rs = n.resources || [], all = rs.length + (core().resources || []).filter(r => !r.gone && (r.on || []).some(o => o.kind === 'concept' && o.id === n.id)).length;
    body = `${all >= 3 ? `<div class="note">You already have ${all} resources here. Another one rarely helps as much as recalling and practicing with what you have. Learn, recall, practice first.</div>` : ''}${PREP.resourcesHTML({ kind: 'concept', id: n.id })}
      ${rs.length ? `<div><div class="sheet-label" style="margin-top:12px">Links saved in an earlier version</div><div class="list">${rs.map(r => `<div class="li"><span class="tag">${esc(r.kind || 'Link')}</span><div class="grow"><div class="title">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title || r.url)}</a>` : esc(r.title)}</div></div><button class="iconbtn" data-a="res-del" data-rid="${r.id}">Remove</button></div>`).join('')}</div></div>` : ''}`;
  } else if (tab === 'related') {
    const pre = (n.prereq || []).map(N).filter(Boolean), dep = (d.dependents[id] || []).map(N).filter(Boolean);
    const sib = (d.kids[n.parentId] || []).filter(x => x.kind === 'concept' && x.id !== id);
    const optsAll = d.subjects.map(s => `<optgroup label="${esc(s.name)}">${conceptsUnder(s.id).filter(x => x.id !== id && !(n.prereq || []).includes(x.id)).map(x => opt(x.id, x.name, '')).join('')}</optgroup>`).join('');
    const li = (x, rm) => `<div class="li clickable" data-a="concept" data-id="${x.id}"><div class="grow"><div class="title" style="font-weight:400">${esc(x.name)}</div><div class="sub">${esc(pathStr(x.id).split(' › ').slice(0, -1).join(' › '))}</div></div>${stateTag((d.cinfo[x.id] || { state: 0 }).state)}${rm ? `<button class="iconbtn" data-a="pre-del" data-pid="${x.id}">Unlink</button>` : ''}</div>`;
    body = `<h3>Prerequisites</h3><div class="list">${pre.map(x => li(x, true)).join('') || '<div class="li small muted">None linked.</div>'}</div>
      <div class="row" style="margin-top:8px"><select data-c="fv" data-k="newPre" style="max-width:420px"><option value="">Link a prerequisite…</option>${optsAll}</select><button class="btn sm" data-a="pre-add">Link</button></div>
      <h3 style="margin-top:20px">Builds toward</h3><div class="list">${dep.map(x => li(x)).join('') || '<div class="li small muted">Nothing depends on this yet.</div>'}</div>
      <h3 style="margin-top:20px">Same topic</h3><div class="list">${sib.slice(0, 12).map(x => li(x)).join('') || '<div class="li small muted">None.</div>'}</div>`;
  } else {
    body = `<div class="stack"><label class="f">Name<input type="text" data-c="fv" data-k="nm" value="${esc(f.nm != null ? f.nm : n.name)}"></label>
      <label class="f">Key formula or rule (shown as the answer when a prompt has none)<textarea data-c="fv" data-k="fo" style="min-height:60px">${esc(f.fo != null ? f.fo : n.formula || '')}</textarea></label>
      <label class="f">Notes<textarea data-c="fv" data-k="no">${esc(f.no != null ? f.no : n.notes || '')}</textarea></label>
      <label class="f">Importance for your exam<select data-c="fv" data-k="im">${[['', 'Same as subject'], ['3', 'High'], ['2', 'Medium'], ['1', 'Low']].map(x => opt(x[0], x[1], f.im != null ? f.im : (n.imp || ''))).join('')}</select></label>
      <div class="row"><button class="btn primary sm" data-a="cn-save">Save</button><button class="btn sm" data-a="node-archive" data-id="${id}">${n.archived ? 'Unarchive' : 'Archive'}</button><button class="btn sm danger" data-a="node-del" data-id="${id}">Delete concept</button><button class="btn sm ghost" data-a="mem-reset">Reset memory data</button></div></div>`;
  }
  const html = `<div class="mhead"><div><div class="small muted">${esc(pathStr(id).split(' › ').slice(0, -1).join(' › '))}</div><h2>${esc(n.name)}</h2><div class="row" style="margin-top:6px">${stateTag(i.state)}${n.archived ? '<span class="tag">Archived</span>' : ''}</div></div><button class="x" data-a="close" aria-label="Close">×</button></div>
    <div class="stats">${stat(i.mastery.value == null ? '–' : pct(i.mastery.value), i.mastery.value == null ? 'Mastery: needs more evidence' : 'Est. mastery (' + i.mastery.level + ' evidence)')}
      ${stat(i.R == null ? '–' : pct(i.R), 'Est. recall now')}${stat(fmtDur(ix.sec), 'Total study')}${stat(ix.sessions.length, 'Sessions')}
      ${stat(lastS ? fmtDate(lastS.startedAt) : '–', 'Last studied')}${stat(lastR ? fmtDate(lastR.at) : '–', 'Last recalled')}${stat(m && m.due ? relDue(m.due) : '–', 'Next review')}${stat(okR + ' / ' + badR, 'Recalls ok / failed')}</div>
    <div class="row"><button class="btn primary sm" data-a="start-concept" data-id="${id}"${c.active ? ' disabled' : ''}>Start session on this</button><button class="btn sm" data-a="recall-one" data-id="${id}">Recall now</button></div>
    <div><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-a="cn-tab" data-v="${k}">${l}</button>`).join('')}</div>${body}</div>`;
  return { html, wide: true };
}
function teachResHTML(r) {
  const sec = (t, arr) => arr && arr.length ? `<div><div class="sheet-label">${t}</div><ul class="small" style="margin:0;padding-left:20px">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `<div class="panel stack" style="margin-top:12px"><div class="spread"><h3>What the check found</h3><b class="num" style="font-size:26px">${esc(r.score)} / 100</b></div>
    ${sec('Correct', r.correct)}${sec('Missing', r.missing)}${sec('Misconceptions', r.misconceptions)}${sec('Relationships to add', r.relationships)}${r.next ? `<div class="note blue">${esc(r.next)}</div>` : ''}
    <p class="tiny muted">AI feedback can be wrong. Check anything surprising against a trusted source.</p></div>`;
}

/* =====================================================================
   MISTAKES
   ===================================================================== */
function misRow(x) {
  const st = RETRY_STAGES[Math.min(x.stage || 0, RETRY_STAGES.length - 1)];
  return `<div class="li clickable" data-a="mis-open" data-id="${x.id}"><span class="tag red">${esc(MT_NAME[x.type] || x.type)}</span><div class="grow"><div class="title">${esc((x.q || 'Untitled mistake').slice(0, 120))}</div><div class="sub">${x.cid && N(x.cid) ? esc(N(x.cid).name) + ', ' : ''}${fmtDate(x.at)}${x.src ? ', ' + esc(x.src) : ''}</div></div>
    <span class="small muted">${x.resolved ? 'Resolved' : st[1] + ', ' + relDue(x.next)}</span></div>`;
}
function viewMistakes() {
  const d = derive(), o = ui.mis, end = dayStart(addDays(d.today, 1), d.sh);
  let list = d.mistakes;
  if (o.filter === 'due') list = list.filter(x => !x.resolved && x.next < end);
  else if (o.filter === 'open') list = list.filter(x => !x.resolved);
  else if (o.filter === 'resolved') list = list.filter(x => x.resolved);
  if (o.type) list = list.filter(x => x.type === o.type);
  const since = d.now - 30 * DAY, prev = d.now - 60 * DAY;
  const cnt = {}, cntPrev = {};
  d.mistakes.forEach(x => { if (x.at >= since) cnt[x.type] = (cnt[x.type] || 0) + 1; else if (x.at >= prev) cntPrev[x.type] = (cntPrev[x.type] || 0) + 1; });
  const types = Object.keys(Object.assign({}, cnt, cntPrev)).sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0));
  const mx = Math.max(1, ...types.map(t => Math.max(cnt[t] || 0, cntPrev[t] || 0)));
  const byC = {}; d.mistakes.filter(x => x.cid && !x.resolved).forEach(x => byC[x.cid] = (byC[x.cid] || 0) + 1);
  const repeatC = Object.entries(byC).filter(x => x[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const dueN = d.mistakes.filter(x => !x.resolved && x.next < end).length;
  return `<div class="page-head"><div><h1>My mistakes</h1><p>Every mistake is learning data. Log what went wrong and why, then retry it: after a day, independently after three, with a similar problem after a week, and once more after three weeks.</p></div>
    <div class="row"><button class="btn primary" data-a="mis-add">Log a mistake</button>${dueN ? `<button class="btn" data-a="mis-retry-next">Retry ${dueN} due</button>` : ''}</div></div>
    <div class="chips" style="margin-bottom:14px">${[['due', 'Due for retry'], ['open', 'All open'], ['resolved', 'Resolved'], ['all', 'Everything']].map(([k, l]) => chip(l, o.filter === k, `data-a="mis-filter" data-v="${k}"`)).join('')}
      <select data-c="mis-type" style="width:auto">${opt('', 'Every type', o.type)}${MISTAKE_TYPES.map(t => opt(t[0], t[1], o.type)).join('')}</select></div>
    <div class="panel tight"><div class="list">${list.map(misRow).join('') || '<div class="li muted">Nothing here.</div>'}</div></div>
    ${types.length ? `<section class="block"><h2 style="margin-bottom:6px">Recurring types</h2><p class="small muted" style="margin-bottom:10px">Last 30 days, with the 30 days before as a thin marker. Falling counts mean the retries are working.</p>
      <div class="panel">${types.map(t => hbar(esc(MT_NAME[t] || t), 'var(--red)', cnt[t] || 0, mx, (cnt[t] || 0) + (cntPrev[t] != null ? ' (was ' + cntPrev[t] + ')' : ''), (cntPrev[t] || 0) / mx)).join('')}</div></section>` : ''}
    ${repeatC.length ? `<section class="block"><h2 style="margin-bottom:10px">Concepts with repeated mistakes</h2><div class="list">${repeatC.map(([cid, k]) => `<div class="li clickable" data-a="concept" data-id="${cid}"><div class="grow"><div class="title">${esc((N(cid) || {}).name || 'Removed')}</div></div><span class="tag red">${k} open</span></div>`).join('')}</div>
      <p class="small muted" style="margin-top:8px">These get extra weight in review priority. Check their prerequisites too.</p></section>` : ''}`;
}

/* =====================================================================
   HISTORY
   ===================================================================== */
function viewHistory() {
  const d = derive(), o = ui.hist;
  let list = d.sessions.slice().reverse();
  if (!o.showDiscarded) list = list.filter(s => s.status !== 'discarded');
  if (o.subj) list = list.filter(s => sesSubject(s) === o.subj || splitOf(s).some(p => p.s === o.subj));
  if (o.mode) list = list.filter(s => s.mode === o.mode);
  if (o.src) list = list.filter(s => (s.source || 'timer') === o.src);
  if (o.exam) list = list.filter(s => s.examId === o.exam);
  if (o.from) list = list.filter(s => dayKey(s.startedAt, d.sh) >= o.from);
  if (o.to) list = list.filter(s => dayKey(s.startedAt, d.sh) <= o.to);
  if (o.q) { const q = o.q.toLowerCase(); list = list.filter(s => (sesLabel(s) + ' ' + sesCrumb(s) + ' ' + (s.notes || '')).toLowerCase().includes(q)); }
  const groups = []; let cur = null;
  list.slice(0, 400).forEach(s => { const k = dayKey(s.startedAt, d.sh); if (!cur || cur.k !== k) { cur = { k, items: [], sec: 0 }; groups.push(cur); } cur.items.push(s); if (s.status !== 'discarded') cur.sec += s.focusSec; });
  const c = core();
  return `<div class="page-head"><div><h1>Session history</h1><p>Every session, timer-tracked or entered by hand, kept separate so your totals stay trustworthy. Edits never hide where the time came from.</p></div>
    <div class="row"><button class="btn primary" data-a="manual-open">Add past study</button></div></div>
    <div class="panel stack"><label class="f" for="nl-box">Log study in your own words</label>
      <div class="row"><input type="text" id="nl-box" placeholder="I studied percentages for 45 minutes yesterday" style="flex:1;min-width:240px" data-enter="nl-log"><button class="btn" data-a="nl-log"${ui.nlBusy ? ' disabled' : ''}>${ui.nlBusy ? 'Reading…' : 'Log it'}</button></div>
      <p class="tiny muted">You will confirm before anything is saved. If a timer session already covers it, your figure is stored as self-reported next to the timer's time instead of replacing it.</p></div>
    <div class="row" style="margin:18px 0 8px">
      <select data-c="hist" data-k="subj" style="width:auto">${opt('', 'All subjects', o.subj)}${d.subjects.map(s => opt(s.id, s.name, o.subj)).join('')}</select>
      <select data-c="hist" data-k="mode" style="width:auto">${opt('', 'All modes', o.mode)}${MODES.map(m => opt(m[0], m[1], o.mode)).join('')}</select>
      <select data-c="hist" data-k="src" style="width:auto">${opt('', 'Timer and manual', o.src)}${opt('timer', 'Timer only', o.src)}${opt('manual', 'Manual only', o.src)}${opt('imported', 'Imported', o.src)}</select>
      ${c.exams.length > 1 ? `<select data-c="hist" data-k="exam" style="width:auto">${opt('', 'All exams', o.exam)}${c.exams.map(e => opt(e.id, e.name, o.exam)).join('')}</select>` : ''}
      <input type="date" data-c="hist" data-k="from" value="${esc(o.from)}" style="width:auto" aria-label="From date"><input type="date" data-c="hist" data-k="to" value="${esc(o.to)}" style="width:auto" aria-label="To date">
      <input type="text" data-c="hist" data-k="q" value="${esc(o.q)}" placeholder="Search" style="width:160px">
      ${chip('Show discarded', o.showDiscarded, 'data-a="hist-disc"')}</div>
    ${groups.map(g => `<section class="block" style="margin-top:20px"><div class="spread" style="margin-bottom:4px"><h3>${fmtDayLong(g.k)}</h3><span class="num" style="font-size:20px">${fmtDur(g.sec)}</span></div><div class="list">${g.items.map(sesRow).join('')}</div></section>`).join('') || '<div class="empty"><p>No sessions match.</p></div>'}`;
}

/* =====================================================================
   CALENDAR (study + memory)
   ===================================================================== */
function viewCalendar() {
  const d = derive(), c = core(), o = ui.cal;
  const month = o.month || d.today.slice(0, 7);
  const first = month + '-01', gridStart = weekStart(first);
  const dueBy = {}; liveConcepts().forEach(cn => { const m = c.mem[cn.id]; if (m && m.due) { const k = dayKey(m.due, d.sh) < d.today ? d.today : dayKey(m.due, d.sh); (dueBy[k] || (dueBy[k] = [])).push(cn.id); } });
  const misBy = {}; d.mistakes.filter(x => !x.resolved).forEach(x => { const k = dayKey(x.next, d.sh) < d.today ? d.today : dayKey(x.next, d.sh); misBy[k] = (misBy[k] || 0) + 1; });
  const revDone = {}; d.reviews.forEach(r => { const k = dayKey(r.at, d.sh); revDone[k] = (revDone[k] || 0) + 1; });
  const examDays = {}; c.exams.forEach(e => { if (e.date) examDays[e.date] = e.name; });
  const tabs = `<div class="tabs" role="tablist"><button role="tab" aria-selected="${o.tab === 'study'}" data-a="cal-tab" data-v="study">Study calendar</button><button role="tab" aria-selected="${o.tab === 'memory'}" data-a="cal-tab" data-v="memory">Memory calendar</button></div>`;
  const head = `<div class="page-head"><div><h1>Calendar</h1><p>What you studied and what you need to recall. Pick a day to see its full history.</p></div></div>`;
  if (o.tab === 'memory') {
    const days = rangeKeys(d.today, addDays(d.today, 27));
    const secs = days.filter(k => dueBy[k] || misBy[k]).map(k => `<section class="block" style="margin-top:16px"><div class="spread"><h3>${k === d.today ? 'Today' : k === addDays(d.today, 1) ? 'Tomorrow' : fmtDayLong(k)}</h3><span class="small muted">${dueBy[k] ? plural(dueBy[k].length, 'review') : ''}${misBy[k] ? (dueBy[k] ? ', ' : '') + plural(misBy[k], 'mistake retry', 'mistake retries') : ''}</span></div>
      <div class="chips" style="margin-top:6px">${(dueBy[k] || []).slice(0, 40).map(cid => `<button class="chip" data-a="concept" data-id="${cid}">${dot(subjColor(d.subjOf[cid]))}${esc(N(cid).name)}</button>`).join('')}${(dueBy[k] || []).length > 40 ? `<span class="small muted">and ${dueBy[k].length - 40} more</span>` : ''}</div></section>`).join('');
    return head + tabs + `<p class="small muted" style="margin-bottom:12px">Reviews the scheduler has booked. Anything overdue is shown under today.</p>` + (secs || '<p class="muted">Nothing scheduled in the next four weeks yet. Study something and recall it; reviews appear here.</p>');
  }
  const cells = []; let k = gridStart;
  for (let i = 0; i < 42; i++) { cells.push(k); k = addDays(k, 1); if (i === 34 && k.slice(0, 7) !== month) break; }
  const mName = keyToDate(first).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const grid = cells.map(k => {
    const x = d.days[k], other = k.slice(0, 7) !== month, fut = k > d.today;
    return `<button class="${other ? 'other' : ''}${k === d.today ? ' today' : ''}${o.sel === k ? ' sel' : ''}" data-a="cal-day" data-v="${k}" aria-label="${fmtDayLong(k)}"><span class="d">${Number(k.slice(8))}${examDays[k] ? ' <b style="color:var(--red)">Exam</b>' : ''}</span>
      ${x && x.sec >= 60 ? `<span class="m">${fmtDur(x.sec)}</span>` : '<span></span>'}
      <span>${fut || k === d.today ? (dueBy[k] ? `<span class="r">${dueBy[k].length} due</span> ` : '') + (misBy[k] ? `<span class="x">${misBy[k]} retry</span>` : '') : (revDone[k] ? `<span class="r">${revDone[k]} recalled</span>` : '')}</span></button>`;
  }).join('');
  let detail = '';
  if (o.sel) {
    const sk = o.sel, x = d.days[sk], ses = d.live.filter(s => dayKey(s.startedAt, d.sh) === sk);
    const rv = d.reviews.filter(r => dayKey(r.at, d.sh) === sk);
    const subE = x ? Object.entries(x.subj).sort((a, b) => b[1] - a[1]) : [];
    detail = `<section class="block"><div class="spread"><h2>${fmtDayLong(sk)}</h2>${x ? `<button class="btn sm" data-a="day-open" data-k="${sk}">Day summary</button>` : ''}</div>
      ${x ? `<div class="stats" style="margin:10px 0">${stat(fmtDur(x.sec), 'Focused study')}${stat(x.n, 'Sessions')}${stat(Object.keys(x.subj).length, 'Subjects')}${stat(rv.length, 'Recalls')}${stat(x.q, 'Questions')}</div>
        <div class="panel">${subE.map(([sid, sec]) => hbar(esc(subjName(sid)), sid === '_none' ? 'var(--faint)' : subjColor(sid), sec, subE[0][1], fmtDur(sec))).join('')}</div>
        <div class="list" style="margin-top:10px">${ses.map(sesRow).join('')}</div>` : '<p class="muted">No study recorded.</p>'}
      ${sk >= d.today && dueBy[sk] ? `<h3 style="margin-top:16px">Recall due</h3><div class="chips" style="margin-top:6px">${dueBy[sk].map(cid => `<button class="chip" data-a="concept" data-id="${cid}">${esc(N(cid).name)}</button>`).join('')}</div>` : ''}
      ${sk === d.today && core().plan ? `<h3 style="margin-top:16px">Planned blocks</h3><p class="small">${core().plan.blocks.map(b => b.min + ' min ' + KIND_NAME[b.kind].toLowerCase()).join(', ')}</p>` : ''}</section>`;
  }
  return head + tabs + `<div class="spread" style="margin-bottom:10px"><h2>${mName}</h2><div class="row"><button class="btn sm" data-a="cal-month" data-v="-1">Previous</button><button class="btn sm" data-a="cal-month" data-v="0">This month</button><button class="btn sm" data-a="cal-month" data-v="1">Next</button></div></div>
    <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => `<div class="dow">${w}</div>`).join('')}${grid}</div>${detail}`;
}

/* =====================================================================
   INSIGHTS
   ===================================================================== */
function rangeBounds(r) {
  const d = derive(), t = d.today, o = ui.ins;
  r = r || o.range;
  if (r === 'today') return [t, t, 'Today'];
  if (r === 'week') return [weekStart(t), t, 'This week'];
  if (r === 'lastweek') return [addDays(weekStart(t), -7), addDays(weekStart(t), -1), 'Last week'];
  if (r === 'month') return [monthStart(t), t, 'This month'];
  if (r === '30') return [addDays(t, -29), t, 'Last 30 days'];
  const a = o.from || addDays(t, -6), b = o.to || t;
  return a <= b ? [a, b, fmtDay(a) + ' to ' + fmtDay(b)] : [b, a, fmtDay(b) + ' to ' + fmtDay(a)];
}
function rangeStats(a, b) {
  const d = derive(), R = sumRange(d.days, a, b);
  const inR = ts => { const k = dayKey(ts, d.sh); return k >= a && k <= b; };
  const rv = d.reviews.filter(r => inR(r.at)), pr = d.practice.filter(p => inR(p.at)), ses = d.live.filter(s => inR(s.startedAt));
  const learned = new Set();
  d.concepts.forEach(cn => { const ix = d.I[cn.id]; if (ix && ix.sessions.length && inR(ix.sessions[0].startedAt)) learned.add(cn.id); });
  const recalled = new Set(rv.filter(r => r.g >= 2).map(r => r.cid));
  const forgotten = new Set(rv.filter(r => r.g === 1 && !r.same).map(r => r.cid));
  const loose = pr.filter(p => !p.ses);
  const q = R.q + sum(loose.map(p => p.n)), qc = R.qc + sum(loose.map(p => p.c));
  const mis = d.mistakes.filter(m => inR(m.at));
  return { R, rv, pr, ses, learned, recalled, forgotten, q, qc, mis, edited: ses.filter(s => s.edited || s.timeEdited).length };
}
function groupSplit(mode) { const g = {}; for (const m in mode) { const k = MODE_GROUP[m] || 'mixed'; g[k] = (g[k] || 0) + mode[m]; } return g; }
function balanceRows(R) {
  const subs = examSubjects(false), shareTot = sum(subs.map(s => s.share || 0));
  return subs.map(s => ({ s, sec: R.subj[s.id] || 0, act: R.sec ? (R.subj[s.id] || 0) / R.sec : 0, plan: shareTot ? (s.share || 0) / shareTot : null }));
}
function methodCompare() {
  const d = derive(), g = {};
  d.reviews.forEach(r => {
    const ix = d.I[r.cid]; if (!ix) return;
    const before = ix.sessions.filter(s => s.startedAt < r.at && s.mode !== 'recall').slice(-1)[0]; if (!before) return;
    const k = MODE_GROUP[before.mode] || 'mixed'; const b = g[k] || (g[k] = [0, 0]); b[0]++; if (r.g >= 2) b[1]++;
  });
  return g;
}
function viewInsights() {
  const d = derive(), o = ui.ins, [a, b, label] = rangeBounds();
  const X = rangeStats(a, b), R = X.R, c = core(), S = c.settings;
  const ranges = [['today', 'Today'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['30', 'Last 30 days'], ['custom', 'Custom']];
  const head = `<div class="page-head"><div><h1>Insights</h1><p>Time, learning and retention side by side. Time shows effort; recall and practice show learning. Neither alone tells the whole story.</p></div>
    <div class="row"><button class="btn" data-a="report-open" data-v="week">Weekly report</button><button class="btn" data-a="report-open" data-v="month">Monthly report</button></div></div>
    <div class="row" style="margin-bottom:18px"><div class="chips">${ranges.map(([k, l]) => chip(l, o.range === k, `data-a="ins-range" data-v="${k}"`)).join('')}</div>
      ${o.range === 'custom' ? `<input type="date" data-c="ins-date" data-k="from" value="${esc(o.from || addDays(d.today, -6))}" style="width:auto" aria-label="From"><input type="date" data-c="ins-date" data-k="to" value="${esc(o.to || d.today)}" style="width:auto" aria-label="To">` : ''}</div>`;
  const avgSes = R.n ? R.sec / R.n : 0;
  const acc = X.q ? X.qc / X.q : null, racc = X.rv.length ? X.rv.filter(r => r.g >= 2).length / X.rv.length : null;
  const tgt = S.dailyMin * 60 * R.dayCount;
  const summary = `<div class="stats">${stat(fmtDur(R.sec), 'Focused study')}${stat(fmtDur(R.sec / Math.max(1, R.dayCount)), 'Average per day')}${stat(R.studyDays + ' / ' + R.dayCount, 'Days studied')}
    ${stat(R.n, 'Sessions')}${stat(fmtDur(avgSes), 'Average session')}${stat(fmtDur(R.longest), 'Longest session')}${stat(X.learned.size, 'Concepts started')}
    ${stat(X.rv.length, 'Recall attempts')}${stat(racc == null ? '–' : pct(racc), 'Recall success')}${stat(X.forgotten.size, 'Concepts forgotten')}${stat(X.q, 'Questions solved')}${stat(acc == null ? '–' : pct(acc), 'Question accuracy')}</div>
    <p class="small muted" style="margin-top:10px">${label}: ${fmtDur(R.sec)} against a target of ${fmtDur(tgt)}. A running session is added when you stop it.</p>`;
  const audit = `<div class="panel">${hbar('Timer-tracked', 'var(--live)', R.timer, Math.max(1, R.sec), fmtDur(R.timer))}${hbar('Manual, self-reported', 'var(--hl)', R.manual, Math.max(1, R.sec), fmtDur(R.manual))}${R.imported ? hbar('Imported', 'var(--faint)', R.imported, R.sec, fmtDur(R.imported)) : ''}
    <div class="hr"></div><p class="small">Pauses and breaks excluded: <b>${fmtDur(R.paused)}</b>. Edited sessions: <b>${X.edited}</b>. Only timer and confirmed manual entries count toward totals; self-reported figures you give for timed sessions are shown next to them, never added.</p></div>`;
  const bal = balanceRows(R).filter(x => x.sec > 0 || x.plan);
  const maxAct = Math.max(0.01, ...bal.map(x => Math.max(x.act, x.plan || 0)));
  const none = R.subj._none || 0;
  let balNote = '';
  if (R.sec >= 2 * 3600 && bal.some(x => x.plan)) {
    const over = bal.filter(x => x.plan != null && x.act - x.plan > 0.1).sort((p, q) => (q.act - q.plan) - (p.act - p.plan))[0];
    const under = bal.filter(x => x.plan != null && x.plan - x.act > 0.08).sort((p, q) => (q.plan - q.act) - (p.plan - p.act)).slice(0, 2);
    if (over || under.length) balNote = `<div class="note" style="margin-top:12px">${over ? `${esc(over.s.name)} took ${pct(over.act)} of your time against a planned ${pct(over.plan)}. ` : ''}${under.length ? `${esc(under.map(x => x.s.name).join(' and '))} ${under.length > 1 ? 'are' : 'is'} below plan. ` : ''}If that was deliberate, nothing needs to change. If not, the daily plan already favours under-covered subjects for new learning.</div>`;
  }
  const subjSec = `<div class="panel">${bal.sort((p, q) => q.sec - p.sec).map(x => hbar(esc(x.s.name), x.s.color, x.act, maxAct, `${fmtDur(x.sec)} <span class="muted">${pct(x.act)}</span>`, x.plan != null ? x.plan / maxAct : null)).join('')}
    ${none ? hbar('<span class="muted">Unassigned</span>', 'var(--faint)', none / Math.max(1, R.sec), maxAct, fmtDur(none)) : ''}
    <p class="tiny muted" style="margin-top:6px">Dark marker: planned share from each subject's settings.</p></div>${balNote}`;
  const tops = Object.entries(R.topic).filter(([id]) => d.byId[id] && d.byId[id].kind === 'topic').sort((p, q) => q[1] - p[1]).slice(0, 12);
  const topicSec = tops.length ? `<div class="panel">${tops.map(([id, sec]) => hbar(esc(d.byId[id].name), subjColor(d.subjOf[id]), sec, tops[0][1], fmtDur(sec))).join('')}</div>` : '<p class="muted">No topic-level time in this range.</p>';
  const grp = groupSplit(R.mode), gt = Math.max(1, sum(Object.values(grp)));
  let modeNote = '';
  if (R.sec >= 3 * 3600) {
    const take = (grp.taking || 0) / gt, ret = (grp.retrieving || 0) / gt;
    if (take > 0.55 && ret < 0.25) modeNote = `<div class="note" style="margin-top:12px">Most time went to taking in material (${pct(take)}) and ${pct(ret)} to recall and practice. Reading and lectures are how you meet new material. Research on retrieval practice suggests that shifting some of that time to recall and problems tends to help retention.</div>`;
  }
  const modesSec = `<div class="panel">${['taking', 'making', 'retrieving', 'mixed'].filter(k => grp[k]).map(k => hbar(GROUP_NAME[k] + ' <span class="muted tiny">' + GROUP_DESC[k] + '</span>', k === 'retrieving' ? 'var(--live)' : k === 'making' ? 'var(--amber)' : k === 'taking' ? 'var(--blue)' : 'var(--faint)', grp[k], gt, `${fmtDur(grp[k])} <span class="muted">${pct(grp[k] / gt)}</span>`)).join('') || '<p class="muted">No sessions in this range.</p>'}
    <div class="row small muted" style="margin-top:8px">${Object.entries(R.mode).sort((p, q) => q[1] - p[1]).map(([m, s]) => `<span class="tag">${esc(MODE_NAME[m] || m)} ${fmtDur(s)}</span>`).join(' ')}</div></div>${modeNote}`;
  // time vs learning
  const allR = sumRange(d.days, firstDayKey(), d.today);
  const tl = examSubjects(false).map(s => {
    const st = subjStats(s.id);
    const srv = X.rv.filter(r => d.subjOf[r.cid] === s.id), spr = X.pr.filter(p => d.subjOf[p.cid] === s.id);
    const pn = sum(spr.map(p => p.n)), pc = sum(spr.map(p => p.c));
    const allRv = d.reviews.filter(r => d.subjOf[r.cid] === s.id), allPr = d.practice.filter(p => d.subjOf[p.cid] === s.id);
    const ev = allRv.length + allPr.length;
    const parts = [st.mastery, allRv.length ? allRv.filter(r => r.g >= 2).length / allRv.length : null, sum(allPr.map(p => p.n)) ? sum(allPr.map(p => p.c)) / sum(allPr.map(p => p.n)) : null].filter(v => v != null);
    return { s, sec: R.subj[s.id] || 0, all: allR.subj[s.id] || 0, st, racc: srv.length ? srv.filter(r => r.g >= 2).length / srv.length : null, rn: srv.length, pacc: pn ? pc / pn : null, pn, ev, score: parts.length ? sum(parts) / parts.length : null };
  }).filter(x => x.all > 0 || x.st.started);
  let effNote = '<p class="tiny muted" style="margin-top:8px">An efficiency comparison appears once at least two subjects each have 3 or more hours and 10 or more recall or practice records.</p>';
  const elig = tl.filter(x => x.all >= 3 * 3600 && x.ev >= 10 && x.score != null).map(x => Object.assign(x, { eff: x.score / (x.all / 3600) }));
  if (elig.length >= 2) {
    elig.sort((p, q) => q.eff - p.eff);
    const hi = elig[0], lo = elig[elig.length - 1];
    if (hi.eff > lo.eff * 1.5) effNote = `<div class="note" style="margin-top:12px">${esc(hi.s.name)} currently appears more time-efficient than ${esc(lo.s.name)} based on your recent retention and practice. This is a correlation in your data, not proof that one way of studying caused it. Subjects differ in difficulty too.</div>`;
  }
  const tlSec = `<div class="scroll-x"><table class="t"><thead><tr><th>Subject</th><th class="n">Time here</th><th class="n">All time</th><th class="n">Concepts retrieved</th><th class="n">Est. mastery</th><th class="n">Recall here</th><th class="n">Practice here</th></tr></thead><tbody>
    ${tl.map(x => `<tr><td>${dot(x.s.color)} ${esc(x.s.name)}</td><td class="n">${fmtDur(x.sec)}</td><td class="n">${fmtDur(x.all)}</td><td class="n">${x.st.retrieved} / ${x.st.cs.length}</td><td class="n">${x.st.mastery == null ? '–' : pct(x.st.mastery)}</td><td class="n">${x.racc == null ? '–' : pct(x.racc) + ' <span class="muted tiny">(' + x.rn + ')</span>'}</td><td class="n">${x.pacc == null ? '–' : pct(x.pacc) + ' <span class="muted tiny">(' + x.pn + ')</span>'}</td></tr>`).join('')}</tbody></table></div>${effNote}`;
  // heatmaps
  const hs = addDays(weekStart(d.today), -19 * 7), tgtSec = Math.max(600, S.dailyMin * 60);
  const heat = rangeKeys(hs, addDays(weekStart(d.today), 6)).map(k => { if (k > d.today) return '<i class="out"></i>'; const x = (d.days[k] || {}).sec || 0; const lv = !x ? '' : x < tgtSec * 0.25 ? 'h1' : x < tgtSec * 0.5 ? 'h2' : x < tgtSec ? 'h3' : 'h4'; return `<i class="${lv}" title="${fmtDay(k)}: ${fmtDur(x)}"></i>`; }).join('');
  const days28 = rangeKeys(addDays(d.today, -27), d.today);
  const sh = examSubjects(false).map(s => { const mx = Math.max(1, ...days28.map(k => ((d.days[k] || {}).subj || {})[s.id] || 0)); return `<div class="r"><span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(s.name)}</span>${days28.map(k => { const v = ((d.days[k] || {}).subj || {})[s.id] || 0; return `<i title="${fmtDay(k)}: ${fmtDur(v)}" style="${v ? `background:color-mix(in srgb,${s.color} ${Math.round(25 + 75 * v / mx)}%,var(--sunk))` : ''}"></i>`; }).join('')}</div>`; }).join('');
  // retention + calibration
  const buckets = [[0, 0.7, 'Below 70%'], [0.7, 0.85, '70–85%'], [0.85, 0.95, '85–95%'], [0.95, 1.01, '95% and above']];
  const withR = X.rv.filter(r => r.R != null && !r.same);
  const calRows = buckets.map(([lo, hi, l]) => { const xs = withR.filter(r => r.R >= lo && r.R < hi); return xs.length ? `<tr><td>${l}</td><td class="n">${xs.length}</td><td class="n">${pct(sum(xs.map(r => r.R)) / xs.length)}</td><td class="n">${pct(xs.filter(r => r.g >= 2).length / xs.length)}</td></tr>` : ''; }).join('');
  const cf = X.rv.filter(r => r.cf);
  const overC = cf.filter(r => r.cf >= 4 && r.g === 1).length, underC = cf.filter(r => r.cf <= 2 && r.g >= 3).length;
  const retSec = `<div class="grid2"><div class="panel"><div class="sheet-label">Model estimate against what happened</div>${calRows ? `<table class="t"><thead><tr><th>Estimated recall</th><th class="n">Reviews</th><th class="n">Average estimate</th><th class="n">Actually recalled</th></tr></thead><tbody>${calRows}</tbody></table><p class="tiny muted" style="margin-top:6px">If the last two columns drift apart, the default scheduler weights fit you less well. Raise or lower the retention target in Settings.</p>` : '<p class="small muted">Appears after reviews of concepts you have seen before.</p>'}</div>
    <div class="panel"><div class="sheet-label">Your confidence against results</div>${cf.length >= 5 ? `<p class="small">${cf.length} rated recalls. Sure but wrong: <b>${overC}</b>. Unsure but right: <b>${underC}</b>.</p><p class="small muted" style="margin-top:6px">${overC > underC * 1.5 && overC >= 3 ? 'You tend to feel surer than your results. Overconfidence often ends study too early; keep testing before calling something done.' : underC > overC * 1.5 && underC >= 3 ? 'You often know more than you feel you do. Your recall results are the better guide.' : 'Your confidence roughly matches your results.'}</p>` : '<p class="small muted">Rate your confidence before revealing answers to see this. At least 5 ratings needed.</p>'}</div></div>`;
  // method comparison
  const mc = methodCompare();
  const mcRows = Object.entries(mc).map(([k, [n, ok]]) => `<tr><td>${GROUP_NAME[k]}</td><td class="n">${n}</td><td class="n">${n >= 20 ? pct(ok / n) : '<span class="muted">needs 20</span>'}</td></tr>`).join('');
  const mcSec = `<div class="panel">${mcRows ? `<table class="t"><thead><tr><th>Last way you studied the concept before a recall</th><th class="n">Recalls</th><th class="n">Success</th></tr></thead><tbody>${mcRows}</tbody></table>` : '<p class="small muted">No recalls after study sessions yet.</p>'}
    <p class="tiny muted" style="margin-top:8px">A comparison from your own history across all time. It shows association, not cause: concepts, difficulty and timing differ between groups.</p></div>`;
  // patterns
  const hrs = []; for (let h = 0; h < 24; h++) hrs.push(R.hours[h] || 0);
  const hmx = Math.max(1, ...hrs);
  let peak = '';
  if (R.n >= 8) { let best = 0, bi = 0; for (let h = 0; h < 24; h++) { const w = hrs[h] + hrs[(h + 1) % 24] + hrs[(h + 2) % 24]; if (w > best) { best = w; bi = h; } } peak = `Most of your study in this range happened between ${bi}:00 and ${(bi + 3) % 24}:00.`; }
  const reread = liveConcepts().filter(cn => { const ix = d.I[cn.id]; if (!ix) return false; const take = sum(ix.sessions.filter(s => MODE_GROUP[s.mode] === 'taking').map(s => s.focusSec / Math.max(1, (s.conceptIds || []).length))); const rv = ix.reviews.slice(-5); return take >= 5400 && rv.length >= 3 && rv.filter(r => r.g >= 2).length / rv.length < 0.6; }).slice(0, 5);
  const patSec = `<div class="panel"><div class="sheet-label">Time of day</div><div class="vbars">${hrs.map((v, h) => `<i style="height:${v / hmx * 100}%" title="${h}:00, ${fmtDur(v)}"></i>`).join('')}</div>
    <div class="spread tiny muted"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
    <p class="small" style="margin-top:8px">${peak || 'A time-of-day pattern appears after about 8 sessions.'}</p>
    ${reread.length ? `<div class="note" style="margin-top:10px">You have spent 90 minutes or more reading or watching lectures on ${esc(reread.map(x => x.name).join(', '))}, but recent recall has stayed below 60%. Retrieval and problems are more likely to move these than another pass through the material.</div>` : ''}</div>`;
  // readiness
  const cs = liveConcepts(), ci = cs.map(cn => d.cinfo[cn.id]);
  const cov1 = cs.length ? ci.filter(x => x.state >= 1).length / cs.length : 0, cov3 = cs.length ? ci.filter(x => x.state >= 3).length / cs.length : 0;
  const mv = ci.map(x => x.mastery.value).filter(v => v != null), rvals = ci.map(x => x.R).filter(v => v != null);
  const p30 = d.practice.filter(p => p.at >= d.now - 30 * DAY), pq = sum(p30.map(p => p.n)), pcq = sum(p30.map(p => p.c));
  const timed = p30.filter(p => p.min && p.n), spd = timed.length ? sum(timed.map(p => p.min)) / sum(timed.map(p => p.n)) : null;
  const mocks = d.live.filter(s => s.mode === 'mock' && s.questionsSolved);
  const r30 = d.reviews.filter(r => r.at >= d.now - 30 * DAY && r.od != null), ontime = r30.length ? r30.filter(r => r.od <= 1).length / r30.length : null;
  const d28 = sumRange(d.days, addDays(d.today, -27), d.today);
  const weakN = cs.filter(cn => { const x = d.cinfo[cn.id]; return (x.mastery.value != null && x.mastery.value < 0.5) || (x.m && (x.m.lapses || 0) >= 2); }).length;
  const readySec = `<div class="stats">${stat(pct(cov1), 'Syllabus started')}${stat(pct(cov3), 'Retrieved at least once')}${stat(mv.length ? pct(sum(mv) / mv.length) : '–', 'Est. mastery (' + mv.length + ' concepts)')}${stat(rvals.length ? pct(sum(rvals) / rvals.length) : '–', 'Average est. recall')}
    ${stat(pq ? pct(pcq / pq) : '–', 'Practice accuracy, 30 days')}${stat(spd == null ? '–' : spd.toFixed(1) + 'm', 'Minutes per question')}${stat(mocks.length ? pct(sum(mocks.map(s => s.questionsCorrect || 0)) / sum(mocks.map(s => s.questionsSolved))) : '–', 'Mock accuracy (' + mocks.length + ')')}
    ${stat(weakN, 'Weak concepts')}${stat(ontime == null ? '–' : pct(ontime), 'Reviews on time, 30 days')}${stat(d28.studyDays + ' / 28', 'Study days, 4 weeks')}${stat(fmtDur(allR.sec), 'Total study time')}</div>
    <p class="small muted" style="margin-top:10px">Readiness is estimated from coverage, recall, practice, mocks and review consistency. Study time is shown for context only; it is not a readiness score.</p>`;
  const mis = {}; X.mis.forEach(m => mis[m.type] = (mis[m.type] || 0) + 1);
  const misSec = Object.keys(mis).length ? `<div class="panel">${Object.entries(mis).sort((p, q) => q[1] - p[1]).map(([t, n]) => hbar(esc(MT_NAME[t] || t), 'var(--red)', n, Math.max(...Object.values(mis)), String(n))).join('')}</div>` : '<p class="muted">No mistakes logged in this range.</p>';
  const sec = (t, body, p) => `<section class="block"><h2 style="margin-bottom:${p ? 4 : 12}px">${t}</h2>${p ? `<p class="small muted" style="margin-bottom:12px">${p}</p>` : ''}${body}</section>`;
  return head + summary + sec('Time audit', audit) + sec('Time by subject', subjSec) + sec('Time by topic', topicSec) + sec('How the time was used', modesSec, 'Grouped by what your brain was doing. No mode is judged; reading is how material first comes in.')
    + sec('Time against learning', tlSec) + sec('Consistency', `<div class="panel scroll-x"><div class="heat" aria-label="Study heatmap, last 20 weeks">${heat}</div><p class="tiny muted" style="margin-top:8px">Last 20 weeks, Monday at the top. Darker means closer to your daily target.</p><div class="hr"></div><div class="sheet-label">Subjects, last 28 days</div><div class="sheat">${sh}</div></div>`)
    + sec('Retention and calibration', retSec) + sec('Mistakes', misSec) + sec('Methods compared', mcSec) + sec('Patterns', patSec) + sec('Exam readiness', readySec);
}
function buildReport(kind) {
  const d = derive(), t = d.today;
  const a = kind === 'month' ? addDays(t, -29) : addDays(t, -6);
  const X = rangeStats(a, t), R = X.R, lines = [];
  const title = (kind === 'month' ? 'Monthly' : 'Weekly') + ' learning report, ' + fmtDay(a) + ' to ' + fmtDay(t);
  lines.push(title, '');
  lines.push('Where did my time go?');
  lines.push(`Total ${fmtDur(R.sec)} over ${R.studyDays} of ${R.dayCount} days (timer ${fmtDur(R.timer)}, manual ${fmtDur(R.manual)}), ${R.n} sessions, average ${fmtDur(R.sec / Math.max(1, R.dayCount))} per day.`);
  const bal = balanceRows(R).filter(x => x.sec).sort((p, q) => q.sec - p.sec);
  if (bal.length) lines.push('By subject: ' + bal.map(x => `${x.s.name} ${fmtDur(x.sec)} (${pct(x.act)})`).join('; ') + '.');
  const g = groupSplit(R.mode), gt = Math.max(1, sum(Object.values(g)));
  if (R.sec) lines.push('By activity: ' + Object.entries(g).map(([k, v]) => `${GROUP_NAME[k].toLowerCase()} ${pct(v / gt)}`).join(', ') + '.');
  lines.push('', 'What did I actually learn?');
  lines.push(`Concepts started: ${X.learned.size}${X.learned.size ? ' (' + [...X.learned].slice(0, 8).map(id => N(id).name).join(', ') + (X.learned.size > 8 ? ', …' : '') + ')' : ''}.`);
  lines.push(`Questions solved: ${X.q}${X.q ? ', ' + pct(X.qc / X.q) + ' correct' : ''}.`);
  lines.push('', 'What did I retain?');
  lines.push(`Recall attempts: ${X.rv.length}${X.rv.length ? ', ' + pct(X.rv.filter(r => r.g >= 2).length / X.rv.length) + ' successful' : ''}. Concepts recalled: ${X.recalled.size}. Forgotten: ${X.forgotten.size}${X.forgotten.size ? ' (' + [...X.forgotten].slice(0, 6).map(id => (N(id) || {}).name).filter(Boolean).join(', ') + ')' : ''}.`);
  lines.push('', 'Where am I repeatedly struggling?');
  const mis = {}; X.mis.forEach(m => mis[m.type] = (mis[m.type] || 0) + 1);
  lines.push(X.mis.length ? `Mistakes logged: ${X.mis.length} (` + Object.entries(mis).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${MT_NAME[k]} ${v}`).join(', ') + ').' : 'No mistakes logged.');
  const risk = riskList().slice(0, 6); if (risk.length) lines.push('Most at risk now: ' + risk.map(x => x.name).join(', ') + '.');
  lines.push('', 'Which subjects got too much or too little attention?');
  const dev = balanceRows(R).filter(x => x.plan != null && R.sec).map(x => ({ n: x.s.name, dv: x.act - x.plan })).filter(x => Math.abs(x.dv) >= 0.07).sort((p, q) => q.dv - p.dv);
  lines.push(dev.length ? 'Compared with planned shares: ' + dev.map(x => `${x.n} ${x.dv > 0 ? '+' : ''}${Math.round(x.dv * 100)} points`).join(', ') + '.' : 'Time was close to your planned shares (or there was too little time to compare).');
  if (kind === 'month') {
    const cs = liveConcepts(), mv = cs.map(cn => d.cinfo[cn.id].mastery.value).filter(v => v != null);
    lines.push('', 'Progress', `Concepts retrieved at least once: ${cs.filter(cn => d.cinfo[cn.id].state >= 3).length} of ${cs.length}. Estimated mastery across ${mv.length} concepts with enough evidence: ${mv.length ? pct(sum(mv) / mv.length) : 'not yet available'}.`);
  }
  lines.push('', 'All figures come from your own logs. Estimates of recall and mastery are model outputs, not grades.');
  return { title, text: lines.join('\n') };
}

/* =====================================================================
   COACH
   ===================================================================== */
function coachDigest() {
  const d = derive(), c = core(), S = c.settings, ex = activeExam(), dl = daysLeft();
  const L = [];
  L.push(`Today: ${fmtDayLong(d.today)} (${d.today}). Exam: ${ex ? ex.name + (ex.date ? ', on ' + ex.date + ', ' + dl + ' days left' : '') : 'none set'}. Phase: ${examPhase(dl)}.`);
  L.push(`Targets: ${S.dailyMin} min/day, ${S.weeklyMin} min/week. Learning goals per day: ${S.goal.newConcepts} new concepts, ${S.goal.reviews} recalls, ${S.goal.questions} questions.`);
  const w = sumRange(d.days, addDays(d.today, -6), d.today), m30 = sumRange(d.days, addDays(d.today, -29), d.today), all = sumRange(d.days, firstDayKey(), d.today);
  L.push(`Study time: today ${fmtDur(studiedSec())}, yesterday ${fmtDur((d.days[addDays(d.today, -1)] || {}).sec || 0)}, last 7 days ${fmtDur(w.sec)} (${w.studyDays} days), last 30 days ${fmtDur(m30.sec)}, all time ${fmtDur(all.sec)}.`);
  L.push('Subjects (planned share %, time last 7d, last 30d, all time, concepts total/started/retrieved/stable, est. mastery, due, weak, last studied):');
  examSubjects(false).forEach(s => {
    const st = subjStats(s.id); const last = d.live.filter(x => splitOf(x).some(p => p.s === s.id)).slice(-1)[0];
    L.push(`- ${s.name}: ${s.share || 0}%, ${fmtDur(w.subj[s.id] || 0)}, ${fmtDur(m30.subj[s.id] || 0)}, ${fmtDur(all.subj[s.id] || 0)}, ${st.cs.length}/${st.started}/${st.retrieved}/${st.stable}, ${st.mastery == null ? 'n/a' : pct(st.mastery)}, ${st.due.length}, ${st.weak.length}, ${last ? fmtDate(last.startedAt) : 'never'}`);
  });
  const ctx = planCtx(0);
  L.push(`Reviews due: ${ctx.due.length} (overdue ${ctx.due.filter(x => x.overdue).length}, critical ${ctx.due.filter(x => x.critical).length}). Top due: ${ctx.due.slice(0, 10).map(x => N(x.cid).name + ' [' + subjName(x.sid) + ', est. recall ' + pct(x.R) + ']').join('; ') || 'none'}.`);
  L.push(`Most at risk: ${riskList().slice(0, 10).map(cn => cn.name + ' (' + pct(d.cinfo[cn.id].R) + ', lapses ' + ((c.mem[cn.id] || {}).lapses || 0) + ')').join('; ') || 'none'}.`);
  const mis = {}; d.mistakes.filter(x => x.at >= d.now - 30 * DAY).forEach(x => mis[x.type] = (mis[x.type] || 0) + 1);
  L.push(`Mistakes last 30 days by type: ${Object.entries(mis).map(([k, v]) => MT_NAME[k] + ' ' + v).join(', ') || 'none'}. Open mistakes due for retry: ${misDue().length}.`);
  const p = c.plan; if (p && p.date === d.today) L.push(`Today's plan (${p.avail} min): ${p.blocks.map(b => `${b.min}m ${KIND_NAME[b.kind]}${b.cids.length ? ' [' + conceptNames(b.cids, 3) + ']' : ''}${blockDone(b) ? ' (done)' : ''}`).join('; ')}.`);
  L.push('Sessions in the last 10 days (date, start, subject, detail, mode, focused, source):');
  d.live.filter(s => s.startedAt >= d.now - 10 * DAY).slice(-60).forEach(s => L.push(`- ${dayKey(s.startedAt, d.sh)} ${fmtTime(s.startedAt)}, ${sesLabel(s)}, ${sesCrumb(s) || '-'}, ${MODE_NAME[s.mode] || s.mode}, ${fmtDur(s.focusSec)}, ${s.source || 'timer'}`));
  const rv = d.reviews.filter(r => r.at >= d.now - 14 * DAY);
  L.push(`Recalls last 14 days: ${rv.length}, successful ${rv.filter(r => r.g >= 2).length}.`);
  return L.join('\n').slice(0, 30000);
}
function rangeFromText(t) {
  const d = derive(), k = d.today; t = t.toLowerCase();
  if (/yesterday/.test(t)) return [addDays(k, -1), addDays(k, -1), 'yesterday'];
  if (/last week/.test(t)) return [addDays(weekStart(k), -7), addDays(weekStart(k), -1), 'last week'];
  if (/this week|week/.test(t)) return [weekStart(k), k, 'this week'];
  if (/last month/.test(t)) { const s = monthStart(addDays(monthStart(k), -1)); return [s, addDays(monthStart(k), -1), 'last month']; }
  if (/month/.test(t)) return [monthStart(k), k, 'this month'];
  const pd = parseDate(t, k); if (pd && pd !== k) return [pd, pd, fmtDayLong(pd)];
  return [k, k, 'today'];
}
function subjectInText(t) { const q = new Set(toks(t)); let best = null; derive().subjects.forEach(s => { const st = toks(s.name); const hit = st.filter(w => q.has(w)).length / (st.length || 1); if (hit >= 0.5 && (!best || hit > best.h)) best = { s, h: hit }; }); return best && best.s; }
function coachLocal(q) {
  const d = derive(), c = core(), t = q.toLowerCase().trim();
  if (/\b(studied|revised|read|watched|practi[cs]ed|solved|learn(ed|t)|covered|did)\b/.test(t) && parseDuration(t) && /^(i|today i|yesterday i|this morning i|i've|ive)\b/.test(t)) { nlLog(q); return { text: 'I read that as a study log. Check the details in the dialog before it is saved.' }; }
  let m = t.match(/(?:have ?n.?t|not|no)\s+(?:been\s+)?(?:review|revis|recall)\w*\s+(?:in|for)\s+(\d+)\s+days?/);
  if (m) {
    const n = +m[1], cut = d.now - n * DAY;
    const xs = liveConcepts().filter(cn => { const ix = d.I[cn.id]; const last = Math.max(0, ...((ix && ix.reviews) || []).map(r => r.at)); return d.cinfo[cn.id].state >= 1 && last < cut; });
    return { text: xs.length ? `${xs.length} concepts you have studied have not been recalled in ${n} days:\n` + xs.slice(0, 25).map(cn => `• ${cn.name} (${subjName(d.subjOf[cn.id])})`).join('\n') + (xs.length > 25 ? `\n…and ${xs.length - 25} more.` : '') : `Every concept you have studied has been recalled within the last ${n} days.` };
  }
  if (/what should i (study|do|revise)|plan (for )?(today|my day)|make (me )?a plan|i have \d/.test(t)) {
    if (/revise tonight|revise today/.test(t)) return coachForget();
    const mins = parseDuration(t) || (c.plan && c.plan.avail) || c.settings.dailyMin;
    const p = planDay(planCtx(mins));
    return { text: `For ${fmtDur(mins * 60)} (${examPhase(daysLeft())} phase):\n` + p.blocks.map(b => `• ${b.min} min ${b.title}${b.cids.length ? ': ' + conceptNames(b.cids, 4) : ''}`).join('\n') + (p.notes.length ? '\n\n' + p.notes.join(' ') : ''), actions: [['coach-useplan', 'Use this as today\'s plan', mins]] };
  }
  if (/neglect|ignor|too little|balance|too much/.test(t)) {
    const w = sumRange(d.days, addDays(d.today, -13), d.today);
    const rows = balanceRows(w).map(x => { const last = d.live.filter(s => splitOf(s).some(p => p.s === x.s.id)).slice(-1)[0]; return Object.assign(x, { gap: last ? daysBetween(dayKey(last.startedAt, d.sh), d.today) : null }); }).sort((p, q) => ((p.act - (p.plan || 0)) - (q.act - (q.plan || 0))));
    return { text: `Last 14 days, compared with planned shares (${fmtDur(w.sec)} in total):\n` + rows.map(x => `• ${x.s.name}: ${pct(x.act)} of time vs planned ${x.plan == null ? 'n/a' : pct(x.plan)}; last studied ${x.gap == null ? 'never' : x.gap === 0 ? 'today' : plural(x.gap, 'day') + ' ago'}`).join('\n') };
  }
  if (/forget|at risk|revise tonight|revise today|what should i revise/.test(t)) return coachForget();
  if (/weak/.test(t)) {
    const xs = liveConcepts().filter(cn => d.cinfo[cn.id].mastery.value != null || ((c.mem[cn.id] || {}).lapses || 0) >= 1).sort((p, q) => (d.cinfo[p.id].mastery.value ?? 0.5) - (d.cinfo[q.id].mastery.value ?? 0.5)).slice(0, 12);
    return { text: xs.length ? 'Weakest by estimated mastery and lapses:\n' + xs.map(cn => `• ${cn.name}: mastery ${pct(d.cinfo[cn.id].mastery.value)}, forgotten ${((c.mem[cn.id] || {}).lapses || 0)} times`).join('\n') : 'Not enough recall or practice data yet to call anything weak.' };
  }
  if (/mistake|repeat/.test(t)) {
    const since = d.now - 30 * DAY, mis = {}; d.mistakes.filter(x => x.at >= since).forEach(x => mis[x.type] = (mis[x.type] || 0) + 1);
    const byC = {}; d.mistakes.filter(x => x.cid && !x.resolved).forEach(x => byC[x.cid] = (byC[x.cid] || 0) + 1);
    const rc = Object.entries(byC).filter(x => x[1] >= 2);
    return { text: Object.keys(mis).length ? 'Mistakes in the last 30 days by type: ' + Object.entries(mis).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${MT_NAME[k]} ${v}`).join(', ') + '.' + (rc.length ? '\nConcepts with repeated open mistakes: ' + rc.map(([cid, n]) => `${(N(cid) || {}).name} (${n})`).join(', ') + '.' : '') : 'No mistakes logged in the last 30 days.' };
  }
  if (/what did i (study|do|learn)/.test(t)) {
    const [a, b, lab] = rangeFromText(t);
    const ses = d.live.filter(s => { const k = dayKey(s.startedAt, d.sh); return k >= a && k <= b; });
    return { text: ses.length ? `${lab[0].toUpperCase() + lab.slice(1)}: ${fmtDur(sum(ses.map(s => s.focusSec)))} in ${plural(ses.length, 'session')}.\n` + ses.slice(-20).map(s => `• ${fmtDay(dayKey(s.startedAt, d.sh))} ${fmtTime(s.startedAt)}: ${sesLabel(s)}${sesCrumb(s) ? ', ' + sesCrumb(s) : ''}, ${fmtDur(s.focusSec)} (${(MODE_NAME[s.mode] || '').toLowerCase()})`).join('\n') : `No sessions recorded ${lab === 'today' ? 'today' : 'for ' + lab}.` };
  }
  if (/how (much|long|many hours)|hours|time did i/.test(t)) {
    const [a, b, lab] = rangeFromText(t); const R = sumRange(d.days, a, b); const s = subjectInText(t);
    if (s) return { text: `${s.name}, ${lab}: ${fmtDur(R.subj[s.id] || 0)} of ${fmtDur(R.sec)} total.` };
    const top = Object.entries(R.subj).sort((p, q) => q[1] - p[1]).slice(0, 6);
    return { text: `${lab[0].toUpperCase() + lab.slice(1)}: ${fmtDur(R.sec)} across ${plural(R.n, 'session')} (timer ${fmtDur(R.timer)}, manual ${fmtDur(R.manual)}).` + (top.length ? '\n' + top.map(([sid, v]) => `• ${subjName(sid)}: ${fmtDur(v)}`).join('\n') : '') };
  }
  if (/when did i|last stud|did i study|how well do i know|what about|tell me about/.test(t)) {
    const hit = matchConcept(t);
    if (hit) return { text: conceptSummary(hit.id) };
  }
  return null;
}
function matchConcept(t) {
  const q = new Set(toks(t)); let best = null;
  derive().concepts.forEach(cn => { const nt = toks(cn.name); if (!nt.length) return; const h = nt.filter(w => q.has(w)).length / nt.length; if (h >= 0.6 && (!best || h > best.h)) best = { id: cn.id, h }; });
  return best;
}
function conceptSummary(id) {
  const d = derive(), i = d.cinfo[id], m = core().mem[id], n = N(id), ix = i.ix;
  const lastS = ix.sessions.slice(-1)[0], lastR = ix.reviews.slice(-1)[0];
  return `${n.name} (${pathStr(id).split(' › ').slice(0, -1).join(' › ')})\n• Last studied: ${lastS ? fmtDayLong(dayKey(lastS.startedAt, d.sh)) : 'never'}\n• Total study: ${fmtDur(ix.sec)} across ${plural(ix.sessions.length, 'session')}\n• Successful recalls: ${ix.reviews.filter(r => r.g >= 2).length}, failed: ${ix.reviews.filter(r => r.g === 1).length}\n• Last recall: ${lastR ? ['', 'Again', 'Hard', 'Good', 'Easy'][lastR.g] + ' on ' + fmtDate(lastR.at) : 'none yet'}\n• Estimated recall now: ${pct(i.R)}\n• Next review: ${m && m.due ? relDue(m.due) : 'not scheduled'}\n• State: ${STATES[i.state]}`;
}
function coachForget() {
  const d = derive(), ctx = planCtx(0), risk = riskList();
  const xs = [...new Set(ctx.due.slice(0, 10).map(x => x.cid).concat(risk.slice(0, 6).map(x => x.id)))].slice(0, 12);
  return { text: xs.length ? 'Most likely to slip, most urgent first:\n' + xs.map(id => `• ${N(id).name} (${subjName(d.subjOf[id])}): est. recall ${pct(d.cinfo[id].R)}`).join('\n') + `\n\nAbout ${Math.ceil(xs.length * core().settings.minPerReview)} minutes of recall covers these.` : 'Nothing looks at risk right now. Recall happens after you study and review a few concepts.', actions: xs.length ? [['coach-review', 'Review these now', xs.join(',')]] : [] };
}
function viewCoach() {
  const C = ui.coach;
  const sug = ['What should I study today? I have 90 minutes', 'How much did I study yesterday?', 'Which subject am I neglecting?', 'What am I likely to forget this week?', 'What mistakes am I repeating?', 'What did I study last Monday?', "Show concepts I haven't reviewed in 30 days", 'Which concepts are weak?'];
  return `<div class="page-head"><div><h1>Coach</h1><p>Answers come from your own logs. Questions about time, plans, risk and mistakes are answered instantly on this device${aiOn() ? '; open questions go to Claude, via this app\'s server, with a summary of your data' : ''}. It never invents study time.</p></div>${C.msgs.length ? '<button class="btn sm" data-a="coach-clear">Clear chat</button>' : ''}</div>
  <div class="chat">${C.msgs.map((m, k) => `<div class="msg ${m.role}"${m.live ? ' id="msg-live"' : ''}><span class="mt">${esc(m.text)}</span>${m.src ? `<div class="tiny muted" style="margin-top:6px">${m.src === 'data' ? 'From your data' : 'Claude, from a summary of your data. Check anything surprising.'}</div>` : ''}${(m.actions || []).length ? `<div class="row" style="margin-top:10px">${m.actions.map(x => `<button class="btn sm" data-a="${x[0]}" data-v="${esc(x[2])}">${esc(x[1])}</button>`).join('')}</div>` : ''}${m.role === 'ai' && m.src === 'data' && aiOn() && k === C.msgs.length - 1 && !C.busy ? '<div style="margin-top:8px"><button class="btn sm ghost" data-a="coach-ai">Discuss this with Claude</button></div>' : ''}</div>`).join('')}
    ${C.busy ? '<div class="row"><span class="small muted">Thinking…</span><button class="btn sm ghost" data-a="coach-stop">Stop</button></div>' : ''}</div>
  ${!C.msgs.length ? `<div class="chips" style="margin:6px 0 16px">${sug.map(s => `<button class="chip" data-a="coach-chip" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
  <div class="row" style="margin-top:16px;max-width:760px"><input type="text" id="coach-in" placeholder="Ask about your study, or log it: I studied ratios for 40 minutes" style="flex:1" data-enter="coach-send"${C.busy ? ' disabled' : ''}><button class="btn primary" data-a="coach-send"${C.busy ? ' disabled' : ''}>Send</button></div><div id="chat-end"></div>`;
}
async function coachAsk(q, forceAI) {
  const C = ui.coach; if (C.busy) return;
  if (!forceAI) {
    C.msgs.push({ role: 'me', text: q });
    const loc = coachLocal(q);
    if (loc) { C.msgs.push({ role: 'ai', text: loc.text, src: 'data', actions: loc.actions }); renderMain(); return; }
    if (!aiOn()) { C.msgs.push({ role: 'ai', text: 'I can answer from your data on: study time for any day, week or subject; what you studied on a date; what to study now for a given number of minutes; neglected subjects; what you are likely to forget; weak concepts; repeated mistakes; concepts not reviewed in N days; and a single concept by name. AI answers are not available in this view.', src: 'data' }); renderMain(); return; }
  }
  const exName = (activeExam() || {}).name || 'their exam';
  const RULES = 'You are the study coach inside Logbook PrepOS, a preparation planner. The student is preparing for ' + exName + '. Answer ONLY from the DATA below. If the data does not contain what is needed, say so plainly. Never invent study time, dates or scores. Do not claim that a study method caused an outcome. Be neutral and practical; no guilt, no hype. Keep answers short: plain text, short paragraphs or simple lines starting with "• ", no markdown headings or bold. When you recommend what to do, name specific concepts or subjects from the data.\n\nDATA\n' + coachDigest();
  const turns = C.msgs.filter(m => m.role === 'me' || (m.role === 'ai' && m.text)).slice(-8).map(m => ({ role: m.role === 'me' ? 'user' : 'assistant', content: m.text }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (forceAI) turns.push({ role: 'user', content: 'Explain that in more depth using my data, and tell me what to do next.' });
  if (!turns.length || turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: q });
  const msg = { role: 'ai', text: '', src: 'ai', live: true }; C.msgs.push(msg); C.busy = true; C.ctl = new AbortController(); renderMain();
  try {
    const res = await aiText([{ role: 'user', content: RULES }, { role: 'assistant', content: 'Understood. I will answer only from that data.' }, ...turns], { signal: C.ctl.signal, onText: ({ text }) => { msg.text = text; const el = $('#msg-live .mt'); if (el) el.textContent = text; } });
    msg.text = res.text || msg.text;
  } catch (e) { msg.text = (e && e.text) || ''; const m = aiErr(e); if (m) msg.text += (msg.text ? '\n\n' : '') + m; if (!msg.text) C.msgs.pop(); }
  msg.live = false; C.busy = false; C.ctl = null; if (ui.view === 'coach') renderMain();
}

/* =====================================================================
   METHOD (evidence, algorithms, data model)
   ===================================================================== */
function viewMethod() {
  const S = core().settings;
  return `<div class="page-head"><div><h1>Method</h1><p>What the app does, why, and how sure anyone is. Research-backed principles are kept separate from product rules the app invents.</p></div></div>
  <section class="block" style="margin-top:0"><h2 style="margin-bottom:10px">The loop</h2><div class="panel"><p>Study with the timer running. Straight afterwards, recall what you studied. The scheduler brings each concept back just before you are likely to forget it. Practice problems of rising difficulty; log mistakes and retry them on a staged schedule. Time shows effort; recall, practice and mistakes show learning.</p></div></section>
  <section class="block"><h2 style="margin-bottom:10px">Evidence</h2><div class="panel scroll-x"><table class="t evi"><thead><tr><th>Principle</th><th>Strength</th><th>What the research says</th><th>Sources</th><th>In this app</th></tr></thead><tbody>
    ${EVIDENCE.map(e => `<tr><td>${esc(e.p)}</td><td>${esc(e.s)}</td><td>${esc(e.e)}</td><td class="small muted">${esc(e.src)}</td><td class="small">${esc(e.f)}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="block"><h2 style="margin-bottom:10px">Product rules (not research findings)</h2><div class="panel"><div class="list">${HEURISTICS.map(([t, x]) => `<div class="li" style="align-items:flex-start"><div class="grow"><div class="title">${esc(t)}</div><p class="small" style="margin-top:2px">${esc(x)}</p></div></div>`).join('')}</div></div></section>
  <section class="block"><h2 style="margin-bottom:10px">Current settings</h2><div class="panel small"><p>Retention target ${Math.round(S.retention * 100)}% (high importance +3, low importance −5 points). Study day starts at ${S.dayStartHour}:00. Idle gaps over ${S.idleMin} minutes are flagged. Review priority weights: overdue ${S.weights.overdue}, risk ${S.weights.risk}, importance ${S.weights.importance}, prerequisite ${S.weights.prereq}, lapses ${S.weights.lapses}.</p>
    <p style="margin-top:8px">Plan mix. ${['early', 'middle', 'final'].map(p => `${p[0].toUpperCase() + p.slice(1)}: ` + Object.entries(S.mix[p]).map(([k, v]) => `${KIND_NAME[k].toLowerCase()} ${Math.round(v * 100)}%`).join(', ')).join('. ')}.</p>
    <p style="margin-top:8px">Concept states: ${STATES.join(', ')}. Time studied alone never moves a concept past Exposed.</p></div></section>
  <section class="block"><h2 style="margin-bottom:10px">Architecture</h2><div class="panel"><div class="list">${ARCH_NOTES.map(([t, x]) => `<div class="li" style="align-items:flex-start"><div class="grow"><div class="title">${esc(t)}</div><p class="small" style="margin-top:2px">${esc(x)}</p></div></div>`).join('')}</div></div></section>
  <section class="block"><h2 style="margin-bottom:10px">Data model</h2><pre class="code">${esc(DATA_MODEL_TS)}</pre></section>`;
}

/* =====================================================================
   SETTINGS
   ===================================================================== */
function numIn(k, v, attrs) { return `<input type="number" data-c="set" data-k="${k}" data-t="num" value="${esc(v)}" ${attrs || ''}>`; }
function viewSettings() {
  const c = core(), S = c.settings, f = ui.setF || (ui.setF = { en: '', ed: '' });
  const exams = c.exams.map(e => `<div class="li"><div class="grow grid2" style="gap:8px"><input type="text" data-c="exam-f" data-id="${e.id}" data-k="name" value="${esc(e.name)}" aria-label="Exam name"><input type="date" data-c="exam-f" data-id="${e.id}" data-k="date" value="${esc(e.date || '')}" aria-label="Exam date"></div>
    ${chip(S.activeExamId === e.id || (!S.activeExamId && activeExam() === e) ? 'Active' : 'Make active', S.activeExamId === e.id || (!S.activeExamId && activeExam() === e), `data-a="exam-active" data-id="${e.id}"`)}
    <button class="iconbtn" data-a="exam-archive" data-id="${e.id}">${e.archived ? 'Unarchive' : 'Archive'}</button><button class="iconbtn" data-a="exam-del" data-id="${e.id}">Delete</button></div>`).join('');
  const mix = ['early', 'middle', 'final'].map(p => `<tr><td>${p[0].toUpperCase() + p.slice(1)}</td>${['review', 'new', 'practice', 'mistakes', 'cumulative'].map(k => `<td><input type="number" min="0" max="100" data-c="set" data-k="mix.${p}.${k}" data-t="pct" value="${Math.round(S.mix[p][k] * 100)}" style="width:72px"></td>`).join('')}</tr>`).join('');
  return `<div class="page-head"><div><h1>Settings</h1><p>Everything here is yours to change. Defaults are reasonable starting points, not rules.</p></div></div>
  ${PREP.settingsDataHTML()}
  <section class="block"><h2 style="margin-bottom:10px">Exams</h2><div class="panel"><div class="list">${exams || '<div class="li muted">No exams yet.</div>'}</div>
    <div class="row" style="margin-top:12px"><input type="text" id="exam-new-name" placeholder="Another exam, e.g. a second paper" style="max-width:280px"><input type="date" id="exam-new-date" style="width:auto"><button class="btn sm" data-a="exam-add">Add exam</button></div>
    <p class="tiny muted" style="margin-top:8px">The active exam drives the countdown, roadmap and plan. Subjects can be linked to several exams from the subject's Edit dialog.</p></div></section>
  <section class="block"><h2 style="margin-bottom:10px">You</h2><div class="panel grid2"><label class="f">Name (for the greeting)<input type="text" data-c="set" data-k="name" value="${esc(S.name)}"></label>
    <label class="f">Theme<select data-c="set" data-k="theme">${[['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(x => opt(x[0], x[1], S.theme)).join('')}</select></label></div></section>
  ${PREP.settingsPrepHTML()}
  <section class="block"><h2 style="margin-bottom:10px">Time targets</h2><div class="panel grid3"><label class="f">Daily (minutes)${numIn('dailyMin', S.dailyMin, 'min="10"')}</label><label class="f">Weekly (minutes)${numIn('weeklyMin', S.weeklyMin, 'min="0"')}</label><label class="f">Monthly (minutes)${numIn('monthlyMin', S.monthlyMin, 'min="0"')}</label>
    <p class="tiny muted" style="grid-column:1/-1">Targets are for the charts and streak. The plan uses the study time under Preparation.</p></div></section>
  <section class="block"><h2 style="margin-bottom:10px">Daily learning goals</h2><div class="panel grid3"><label class="f">New concepts${numIn('goal.newConcepts', S.goal.newConcepts, 'min="0"')}</label><label class="f">Recalls${numIn('goal.reviews', S.goal.reviews, 'min="0"')}</label><label class="f">Questions${numIn('goal.questions', S.goal.questions, 'min="0"')}</label></div></section>
  <section class="block"><h2 style="margin-bottom:10px">Memory and reviews</h2><div class="panel stack"><div class="grid3">
    <label class="f">Retention target<select data-c="set" data-k="retention" data-t="num">${[0.8, 0.85, 0.88, 0.9, 0.92, 0.95].map(v => opt(v, Math.round(v * 100) + '%' + (v === 0.9 ? ' (default)' : ''), S.retention)).join('')}</select></label>
    <label class="f">Minutes per review (for planning)${numIn('minPerReview', S.minPerReview, 'min="0.5" step="0.5"')}</label>
    <label class="f">Study day starts at<select data-c="set" data-k="dayStartHour" data-t="num">${[0, 1, 2, 3, 4, 5, 6].map(h => opt(h, h + ':00' + (h === 4 ? ' (default)' : ''), S.dayStartHour)).join('')}</select></label></div>
    <label class="row small"><input type="checkbox" data-c="set" data-k="capToExam" data-t="bool"${S.capToExam ? ' checked' : ''}> Keep every review interval short enough to land before the exam</label>
    <p class="tiny muted">Higher retention means more frequent reviews. Study after midnight but before the day-start hour counts toward the previous day.</p></div></section>
  <section class="block"><h2 style="margin-bottom:10px">Timer</h2><div class="panel grid3"><label class="f">Flag idle gaps longer than (minutes)${numIn('idleMin', S.idleMin, 'min="2"')}</label>
    <label class="f">Pomodoro focus (minutes)${numIn('pomo.focus', S.pomo.focus, 'min="5"')}</label><label class="f">Short break${numIn('pomo.brk', S.pomo.brk, 'min="1"')}</label><label class="f">Long break${numIn('pomo.longBrk', S.pomo.longBrk, 'min="1"')}</label><label class="f">Long break every (blocks)${numIn('pomo.every', S.pomo.every, 'min="2"')}</label></div></section>
  <section class="block"><h2 style="margin-bottom:10px">Planner</h2><div class="panel stack"><p class="small muted">Share of the day per activity in each exam phase (percent). Each row is rescaled to 100 when used.</p>
    <div class="scroll-x"><table class="t"><thead><tr><th>Phase</th><th>Review</th><th>New</th><th>Practice</th><th>Mistakes</th><th>Cumulative</th></tr></thead><tbody>${mix}</tbody></table></div>
    <div class="sheet-label">Review priority weights</div><div class="grid3">${['overdue', 'risk', 'importance', 'prereq', 'lapses'].map(k => `<label class="f">${{ overdue: 'Overdue', risk: 'Forgetting risk', importance: 'Importance', prereq: 'Prerequisite of current work', lapses: 'Past lapses' }[k]}${numIn('weights.' + k, S.weights[k], 'min="0" step="0.5"')}</label>`).join('')}</div>
    <div><button class="btn sm" data-a="planner-reset">Restore planner defaults</button></div></div></section>
  ${PREP.settingsMoreDataHTML()}`;
}
function setPath(obj, path, v) { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] || (o[ks[i]] = {}); o[ks[ks.length - 1]] = v; }

/* =====================================================================
   MODALS
   ===================================================================== */
function pickerHTML(f, o) {
  o = o || {};
  const d = derive(), c = core();
  const exams = c.exams.filter(e => !e.archived);
  const subs = examSubjects(false, f.examId || null);
  const topics = f.subjectId ? (d.kids[f.subjectId] || []).filter(t => t.kind === 'topic' && !t.archived) : [];
  const subtopics = f.topicId ? (d.kids[f.topicId] || []).filter(t => t.kind === 'subtopic' && !t.archived) : [];
  const concepts = (f.subtopicId ? conceptsUnder(f.subtopicId) : f.topicId ? conceptsUnder(f.topicId) : []).filter(cn => !cn.archived);
  const extra = (f.conceptIds || []).filter(id => !concepts.some(cn => cn.id === id)).map(N).filter(Boolean);
  return `<div class="grid2">${exams.length > 1 ? `<label class="f">Exam<select data-c="pk" data-k="examId">${opt('', 'Any exam', f.examId)}${exams.map(e => opt(e.id, e.name, f.examId)).join('')}</select></label>` : ''}
      <label class="f">Subject<select data-c="pk" data-k="subjectId">${opt('', o.subjReq ? 'Choose a subject' : 'No subject (unassigned)', f.subjectId)}${subs.map(s => opt(s.id, s.name, f.subjectId)).join('')}</select></label>
      <label class="f">Topic<select data-c="pk" data-k="topicId"${!f.subjectId ? ' disabled' : ''}>${opt('', 'Whole subject', f.topicId)}${topics.map(t => opt(t.id, t.name, f.topicId)).join('')}</select></label>
      ${subtopics.length ? `<label class="f">Subtopic<select data-c="pk" data-k="subtopicId">${opt('', 'Whole topic', f.subtopicId)}${subtopics.map(t => opt(t.id, t.name, f.subtopicId)).join('')}</select></label>` : ''}</div>
    ${concepts.length || extra.length ? `<div><div class="sheet-label">${o.single ? 'Concept' : 'Concepts'} <span class="muted" style="font-weight:400">(optional${o.single ? '' : '; pick what you will actually work on'})</span></div><div class="chips">${extra.concat(concepts).map(cn => chip(esc(cn.name), (f.conceptIds || []).includes(cn.id), `data-a="pk-c" data-id="${cn.id}"${o.single ? ' data-single="1"' : ''}`)).join('')}</div></div>` : ''}`;
}
function defaultStartF() { return { examId: (activeExam() || {}).id || '', subjectId: '', topicId: '', subtopicId: '', conceptIds: [], mode: 'reading', style: 'stopwatch', minutes: '', confBefore: null, goal: '' }; }
function openStart(f) { ui.modal = { type: 'start', f: Object.assign(defaultStartF(), f || {}) }; renderModal(); }
function openPost(s) {
  if (!s) return;
  const f = { lv: 'standard', pcid: (s.conceptIds || [])[0] || '' };
  const l = s.lectureId && derive().lectures.find(x => x.id === s.lectureId);
  if (l) {
    const pg = derive().lecProg[l.id], full = (l.min || core().prep.defaultLectureMin) * 60;
    if (!pg.watch) f.lecWatched = s.taskKind === 'lecture' ? s.focusSec >= full * 0.8 && !/^Watch part/.test(((core().plan || {}).blocks || []).find(b => b.key === s.planBlock)?.title || '') : s.mode === 'lecture' && s.focusSec >= full * 0.8;
    if (!pg.study) f.lecStudied = s.taskKind === 'selfstudy';
  }
  ui.modal = { type: 'post', sid: s.id, lock: true, f }; render();
}
function findSession(id) { const r = findIn('ses-', 'sessions', id); return r && r.item; }

const MODALS = {
  start() {
    const f = ui.modal.f, a = core().active, d = derive();
    if (a) return { html: `<div class="mhead"><h2>A session is already running</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
      <p>${esc(sesLabel(a))}, ${fmtDur(focusNow(a))} so far. Only one session runs at a time so time is never counted twice.</p>
      <div class="actions"><button class="btn left" data-a="close">Keep studying</button><button class="btn stop" data-a="start-switch">Stop it and start a new one</button></div>` };
    const last = d.live.filter(s => s.source !== 'manual' && (s.subjectId || (s.conceptIds || []).length)).slice(-1)[0];
    const st = STYLES.find(x => x[0] === f.style);
    return { html: `<div class="mhead"><h2>Start study session</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
      ${last ? `<div><button class="chip" data-a="start-continue" data-id="${last.id}">Continue: ${esc(sesLabel(last))}${sesCrumb(last) ? ', ' + esc(sesCrumb(last).slice(0, 60)) : ''}</button></div>` : ''}
      ${pickerHTML(f)}
      <div><div class="sheet-label">What kind of study</div><div class="chips">${MODES.map(([k, l]) => chip(l, f.mode === k, `data-a="fset" data-k="mode" data-v="${k}"`)).join('')}</div></div>
      <div><div class="sheet-label">Timer</div><div class="chips">${STYLES.map(([k, l]) => chip(l, f.style === k, `data-a="fset" data-k="style" data-v="${k}"`)).join('')}</div>
        ${f.style === 'pomodoro' ? `<p class="small muted" style="margin-top:8px">${core().settings.pomo.focus} minutes of focus, then a ${core().settings.pomo.brk}-minute break. Breaks never count as study time.</p>` : f.style !== 'stopwatch' ? `<label class="f" style="margin-top:10px;max-width:220px">Target (minutes)<input type="number" min="1" data-c="fv" data-k="minutes" value="${esc(f.minutes || st[2])}"></label><p class="tiny muted">${f.style === 'mock' ? 'Counts down and stops by itself when time is up.' : f.style === 'deep' ? 'Opens a distraction-free full-screen view.' : 'Chimes at the target; you decide whether to keep going.'}</p>` : '<p class="small muted" style="margin-top:8px">Counts up until you stop.</p>'}</div>
      <details${f.confBefore || f.goal ? ' open' : ''}><summary>Confidence and goal (optional)</summary><div class="stack" style="margin-top:10px"><div><div class="sheet-label">How well do you know this now?</div>${scaleHTML('confBefore', f.confBefore)}</div>
        <label class="f">Goal for this session<input type="text" data-c="fv" data-k="goal" value="${esc(f.goal)}" placeholder="For example, solve ten problems on this topic without notes"></label></div></details>
      <div class="actions"><span class="small muted left kbd-hint"><kbd>N</kbd> opens this from anywhere</span><button class="btn primary lg" data-a="start-go">Start</button></div>` };
  },
  post() {
    const M = ui.modal, s = findSession(M.sid), f = M.f;
    if (!s) return { html: '<p>Session not found.</p><div class="actions"><button class="btn" data-a="close">Close</button></div>' };
    const cs = (s.conceptIds || []).map(N).filter(Boolean);
    const lec = s.lectureId && derive().lectures.find(x => x.id === s.lectureId), lpg = lec && derive().lecProg[lec.id];
    const lecBox = lec ? `<div class="note"><div class="small" style="margin-bottom:6px"><strong>${esc(derive().lecLab[lec.id].label)}</strong></div>
      ${lpg.watch ? '<div class="tiny muted">Watched.</div>' : `<label class="check"><input type="checkbox" data-c="fv" data-k="lecWatched" data-t="bool"${f.lecWatched ? ' checked' : ''}> I finished watching this lecture</label>`}
      ${lpg.study ? '<div class="tiny muted">Self-study done.</div>' : `<label class="check"><input type="checkbox" data-c="fv" data-k="lecStudied" data-t="bool"${f.lecStudied ? ' checked' : ''}> I finished the self-study for it</label>`}</div>` : '';
    return { html: `<div class="mhead"><div><div class="small muted">Session saved</div><h2>${esc(sesLabel(s))}</h2><p class="small muted">${esc(sesCrumb(s))}</p></div></div>
      ${lecBox}
      <div class="row" style="gap:28px;align-items:flex-end"><div><div class="big-dur">${fmtDur(s.focusSec)}</div><div class="small muted">focused, ${fmtTime(s.startedAt)} to ${fmtTime(s.endedAt)}</div></div>
        <div class="small muted">${s.pausedSec ? 'Paused ' + fmtDur(s.pausedSec) + ' (not counted). ' : ''}${s.idleExcludedSec ? 'Idle gap removed: ' + fmtDur(s.idleExcludedSec) + '. ' : ''}${MODE_NAME[s.mode]}.</div></div>
      ${cs.length ? `<div class="note blue">Recalling straight after studying is one of the most useful things you can do. It takes about ${Math.max(2, Math.round(cs.length * 1.5))} minutes for ${plural(cs.length, 'concept')}. A first review is already booked for tomorrow either way.</div>` : ''}
      <details><summary>Add details (optional)</summary><div class="stack" style="margin-top:12px">
        <label class="f">What did you study or cover?<textarea data-c="fv" data-k="notes" style="min-height:60px">${esc(f.notes != null ? f.notes : s.notes || '')}</textarea></label>
        <div class="grid2"><label class="f">What felt difficult?<input type="text" data-c="fv" data-k="difficult" value="${esc(f.difficult || '')}"></label><label class="f">What made sense?<input type="text" data-c="fv" data-k="understood" value="${esc(f.understood || '')}"></label></div>
        <div class="grid3"><div><div class="sheet-label">Focus</div>${scaleHTML('focus', f.focus)}</div><div><div class="sheet-label">Difficulty</div>${scaleHTML('difficulty', f.difficulty)}</div><div><div class="sheet-label">Confidence now</div>${scaleHTML('confAfter', f.confAfter)}</div></div>
        <div class="grid3"><label class="f">Questions solved<input type="number" min="0" data-c="fv" data-k="q" value="${esc(f.q || '')}"></label><label class="f">Correct<input type="number" min="0" data-c="fv" data-k="qc" value="${esc(f.qc || '')}"></label>
          <label class="f">Level<select data-c="fv" data-k="lv">${LEVELS.map(l => opt(l[0], l[1], f.lv)).join('')}</select></label></div>
        ${cs.length > 1 ? `<label class="f">Questions were on<select data-c="fv" data-k="pcid">${cs.map(cn => opt(cn.id, cn.name, f.pcid)).join('')}</select></label>` : ''}
        <p class="tiny muted">A count is enough for practice statistics. To keep a question for spaced re-solving, <button class="linkbtn" data-a="post-qlog">log it individually</button>.</p></div></details>
      <div class="actions"><button class="btn danger left" data-a="post-discard">Discard session</button>${cs.length ? '<button class="btn" data-a="post-practice">Practice now</button><button class="btn primary" data-a="post-recall">Recall now</button>' : ''}<button class="btn${cs.length ? '' : ' primary'}" data-a="post-finish">Finish</button></div>` };
  },
  target() {
    const a = core().active; if (!a) return null;
    return { html: `<div class="mhead"><h2>Target reached</h2></div><p>${fmtDur(a.targetSec)} of focused study. Keep going, or stop and save.</p>
      <div class="actions"><button class="btn" data-a="close">Keep going</button><button class="btn stop" data-a="stop">Stop session</button></div>` };
  },
  idle() {
    const M = ui.modal, a = core().active; if (!a) return null; M.lock = true; const f = M.f || (M.f = {});
    const gap = fmtDur(M.gapSec);
    const why = M.reason === 'sleep' ? `Your device seems to have been asleep for ${gap} while the timer ran.` : M.reason === 'closed' ? `This page was closed for ${gap} while the timer ran.` : `This session has been running for ${gap}. Did you forget to stop it?`;
    return { html: `<div class="mhead"><h2>Did that time count?</h2></div><p>${why} Nothing is changed until you choose.</p>
      <div class="stack">${M.from ? `<button class="btn" data-a="idle-remove">Remove the ${gap} gap and keep timing</button><button class="btn" data-a="idle-stopat">End the session when the gap began (${fmtTime(M.from)})</button>` : ''}
        <div class="row"><input type="datetime-local" data-c="fv" data-k="end" value="${esc(f.end || toLocalInput(M.from || Date.now()))}" style="width:auto"><button class="btn" data-a="idle-end">End the session at this time</button></div>
        <button class="btn primary" data-a="idle-keep">Keep all of it, I was studying</button></div>` };
  },
  confirm() {
    const M = ui.modal;
    return { html: `<div class="mhead"><h2>${esc(M.title)}</h2><button class="x" data-a="close" aria-label="Close">×</button></div><p>${M.text}</p>
      ${M.typeWord ? `<label class="f">Type ${esc(M.typeWord)} to confirm<input type="text" data-c="fv" data-k="word" autocomplete="off"></label>` : ''}
      <div class="actions"><button class="btn" data-a="close">Cancel</button><button class="btn ${M.danger ? 'danger' : 'primary'}" data-a="confirm-yes">${esc(M.yes || 'Confirm')}</button></div>` };
  },
  day() {
    const d = derive(), k = ui.modal.k, x = d.days[k] || { sec: 0, n: 0, subj: {}, q: 0, qc: 0, timer: 0, manual: 0 };
    const rv = d.reviews.filter(r => dayKey(r.at, d.sh) === k);
    const newC = new Set(); d.live.filter(s => dayKey(s.startedAt, d.sh) === k).forEach(s => (s.conceptIds || []).forEach(cid => { const ix = d.I[cid]; if (ix && ix.sessions[0] && dayKey(ix.sessions[0].startedAt, d.sh) === k) newC.add(cid); }));
    const tomorrow = dayStart(addDays(k, 2), d.sh); const dueT = liveConcepts().filter(cn => { const m = core().mem[cn.id]; return m && m.due < tomorrow; }).length;
    const subE = Object.entries(x.subj).sort((p, q) => q[1] - p[1]);
    const S = core().settings;
    return { html: `<div class="mhead"><div><div class="small muted">${k === d.today ? 'Closing the day' : 'Day summary'}</div><h2>${fmtDayLong(k)}</h2></div><button class="x" data-a="close" aria-label="Close">×</button></div>
      <div class="stats">${stat(fmtDur(x.sec), 'Focused study')}${stat(x.n, 'Sessions')}${stat(newC.size, 'New concepts')}${stat(rv.length, 'Recalls')}${stat(rv.length ? pct(rv.filter(r => r.g >= 2).length / rv.length) : '–', 'Recall success')}${stat(x.q, 'Questions')}</div>
      ${subE.length ? `<div>${subE.map(([sid, sec]) => hbar(esc(subjName(sid)), sid === '_none' ? 'var(--faint)' : subjColor(sid), sec, subE[0][1], fmtDur(sec))).join('')}</div>` : ''}
      <p>${x.sec >= S.dailyMin * 60 ? 'You met your time target.' : x.sec ? 'Every session counts. Whatever is unfinished simply moves on.' : 'No study recorded. Rest days happen; tomorrow starts fresh with the reviews that matter most.'} ${k === d.today ? `${plural(dueT, 'review')} ${dueT === 1 ? 'is' : 'are'} ready for tomorrow.` : ''}</p>
      <div class="actions"><button class="btn primary" data-a="close">Done</button></div>` };
  },
  more() {
    return { html: `<div class="mhead"><h2>More</h2><button class="x" data-a="close" aria-label="Close">×</button></div><div class="list">${NAV.filter(n => !['today', 'review', 'subjects'].includes(n[0])).map(([k, l]) => `<div class="li clickable" data-a="nav" data-v="${k}"><div class="grow"><div class="title">${l}</div></div></div>`).join('')}</div><p><button class="save-status" data-a="storage-open">${(() => { const i = saveStatusInfo(); return `<span class="sdot ${i.tone}" aria-hidden="true"></span><span>${esc(i.text)}</span>`; })()}</button></p>` };
  },
  subject() {
    const M = ui.modal, f = M.f, c = core();
    return { html: `<div class="mhead"><h2>${M.id ? 'Edit subject' : 'Add subject'}</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
      <label class="f">Name<input type="text" data-c="fv" data-k="name" value="${esc(f.name)}" data-enter="subj-save"></label>
      ${c.exams.length ? `<div><div class="sheet-label">Exams it belongs to</div><div class="chips">${c.exams.map(e => chip(esc(e.name), f.examIds.includes(e.id), `data-a="subj-exam-t" data-id="${e.id}"`)).join('')}</div></div>` : ''}
      <div class="grid3"><label class="f">Importance for the exam<select data-c="fv" data-k="imp">${[[3, 'High'], [2, 'Medium'], [1, 'Low']].map(x => opt(x[0], x[1], f.imp)).join('')}</select></label>
        <label class="f">Difficulty for you<select data-c="fv" data-k="diff">${[[1, 'Easy'], [2, 'Medium'], [3, 'Hard']].map(x => opt(x[0], x[1], f.diff)).join('')}</select></label>
        <label class="f">Priority<select data-c="fv" data-k="priority">${[[3, 'Do first'], [2, 'Normal'], [1, 'Later']].map(x => opt(x[0], x[1], f.priority)).join('')}</select></label></div>
      <div class="grid3"><label class="f">Estimated study time, hours (optional)<input type="number" min="0" step="1" data-c="fv" data-k="estHours" value="${esc(f.estHours || '')}"></label>
        <label class="f">Finish learning by (optional)<input type="date" data-c="fv" data-k="targetDate" value="${esc(f.targetDate || '')}"></label>
        <label class="f">Planned share of time, % (optional)<input type="number" min="0" max="100" data-c="fv" data-k="share" value="${esc(f.share || '')}" placeholder="Automatic"></label></div>
      ${derive().subjects.filter(x => x.id !== M.id).length ? `<div><div class="sheet-label">Learn after (prerequisite subjects)</div><div class="chips">${derive().subjects.filter(x => x.id !== M.id && !x.archived).map(x => chip(esc(x.name), (f.prereqSubjects || []).includes(x.id), `data-a="subj-pre-t" data-id="${x.id}"`)).join('')}</div></div>` : ''}
      <div><div class="sheet-label">Colour</div><div class="chips">${PALETTE.map(col => `<button type="button" class="chip" aria-pressed="${f.color === col}" data-a="fset" data-k="color" data-v="${col}" aria-label="Colour ${col}"><span class="dot" style="background:${col};width:16px;height:16px"></span></button>`).join('')}</div></div>
      <label class="f">Description (optional)<input type="text" data-c="fv" data-k="desc" value="${esc(f.desc || '')}"></label>
      <div class="actions"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="subj-save">${M.id ? 'Save' : 'Add subject'}</button></div>` };
  },
  node() {
    const M = ui.modal, f = M.f, kindName = { topic: 'topic', subtopic: 'subtopic', concept: 'concept' }[M.kind] || 'item';
    const multi = !M.id && M.kind === 'concept';
    return { html: `<div class="mhead"><h2>${M.id ? 'Rename ' + kindName : 'Add ' + kindName + (multi ? 's' : '')}</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
      ${M.parentId ? `<p class="small muted">In ${esc(pathStr(M.parentId))}</p>` : ''}
      ${multi ? `<label class="f">Concept names, one per line<textarea data-c="fv" data-k="name" style="min-height:120px" placeholder="Newton's second law&#10;Work–energy theorem">${esc(f.name)}</textarea></label><p class="tiny muted">A concept is one idea you could be asked to recall on its own.</p>`
        : `<label class="f">Name<input type="text" data-c="fv" data-k="name" value="${esc(f.name)}" data-enter="node-save"></label>`}
      <div class="actions"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="node-save">${M.id ? 'Save' : 'Add'}</button></div>` };
  },
  concept() { return modalConcept(); },
  mistake() {
    const M = ui.modal, f = M.f;
    return { html: `<div class="mhead"><h2>${M.id ? 'Edit mistake' : 'Log a mistake'}</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
      <label class="f">The question or problem<textarea data-c="fv" data-k="q" style="min-height:70px">${esc(f.q || '')}</textarea></label>
      ${pickerHTML(f, { single: true })}
      <div><div class="sheet-label">Type of mistake</div><div class="chips">${MISTAKE_TYPES.map(([k, l]) => chip(l, f.type === k, `data-a="fset" data-k="type" data-v="${k}"`)).join('')}</div></div>
      <label class="f">Why did it happen?<input type="text" data-c="fv" data-k="why" value="${esc(f.why || '')}"></label>
      <label class="f">Correct reasoning<textarea data-c="fv" data-k="fix" style="min-height:70px">${esc(f.fix || '')}</textarea></label>
      <div class="grid2"><label class="f">What to remember next time<input type="text" data-c="fv" data-k="remember" value="${esc(f.remember || '')}"></label><label class="f">Source (optional)<input type="text" data-c="fv" data-k="src" value="${esc(f.src || '')}" placeholder="Paper 2021 Q34, test series…"></label></div>
      <div class="actions">${M.id ? '<button class="btn danger left" data-a="mis-del">Delete</button>' : ''}<button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="mis-save">Save</button></div>` };
  },
  retry() {
    const M = ui.modal, x = derive().mistakes.find(m => m.id === M.id);
    if (!x) return { html: '<p>Not found.</p><div class="actions"><button class="btn" data-a="close">Close</button></div>' };
    const st = RETRY_STAGES[Math.min(x.stage || 0, 3)];
    return { html: `<div class="mhead"><div><div class="small muted">${esc(st[1])}${x.cid && N(x.cid) ? ', ' + esc(N(x.cid).name) : ''}</div><h2>Retry a mistake</h2></div><button class="x" data-a="close" aria-label="Close">×</button></div>
      <div class="card" style="max-width:none"><div class="prompt" style="font-size:19px">${esc(x.q || '(no question text)')}</div>
      ${x.stage === 2 ? '<p class="small muted">This stage asks for a similar problem, not the same one. Find one from a past paper or workbook on the same idea.</p>' : '<p class="small muted">Solve it again without looking at the correct reasoning.</p>'}
      ${M.shown ? `<div><span class="tag red">${esc(MT_NAME[x.type])}</span></div>${x.why ? `<p><b>Why it went wrong:</b> ${esc(x.why)}</p>` : ''}${x.fix ? `<div class="answer">${esc(x.fix)}</div>` : ''}${x.remember ? `<div class="note">${esc(x.remember)}</div>` : ''}${PREP.mistakeQuestionHTML(x)}` : ''}</div>
      <div class="actions">${M.shown ? '<button class="btn" data-a="retry-res" data-v="wrong">Still wrong</button><button class="btn" data-a="retry-res" data-v="partly">Partly</button><button class="btn primary" data-a="retry-res" data-v="right">Got it right</button>' : `<button class="btn left" data-a="mis-edit" data-id="${x.id}">Edit</button><button class="btn primary" data-a="retry-reveal">I have tried it: show the reasoning</button>`}</div>` };
  },
  manual() {
    const M = ui.modal, f = M.f, cands = M.cands || [];
    return { html: `<div class="mhead"><h2>${M.nl ? 'Check this study log' : 'Add past study'}</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
      ${M.nl ? `<p class="small muted">From: "${esc(M.nl)}"${M.aiUsed ? ' (read with Claude)' : ''}. Fix anything that is off.</p>` : '<p class="small muted">Manual entries are labelled as self-reported and kept apart from timer-tracked time in every report.</p>'}
      ${cands.length ? `<div class="panel tight stack"><div class="sheet-label">A timer already covers this</div>${cands.map(c => chip(esc(c.label), f.attach === c.id, `data-a="fset" data-k="attach" data-v="${c.id}"`)).join('')}${chip('No, this is separate study', !f.attach, 'data-a="fset" data-k="attach" data-v=""')}
        <p class="tiny muted">Attaching stores your figure as self-reported next to the timer's time. Totals keep using the timer.</p></div>` : ''}
      <div class="grid3"><label class="f">Date<input type="date" data-c="fv" data-k="date" value="${esc(f.date)}" max="${derive().today}"></label><label class="f">Start time<input type="time" data-c="fv" data-k="time" value="${esc(f.time)}"></label>
        <label class="f">Duration (minutes)<input type="number" min="1" data-c="fv" data-k="dur" value="${esc(f.dur)}"></label></div>
      ${f.attach ? '' : pickerHTML(f)}
      ${f.attach ? '' : `<div><div class="sheet-label">What kind of study</div><div class="chips">${MODES.map(([k, l]) => chip(l, f.mode === k, `data-a="fset" data-k="mode" data-v="${k}"`)).join('')}</div></div>
      <div class="grid3"><label class="f">Questions solved<input type="number" min="0" data-c="fv" data-k="q" value="${esc(f.q || '')}"></label><label class="f">Correct<input type="number" min="0" data-c="fv" data-k="qc" value="${esc(f.qc || '')}"></label><span></span></div>
      <label class="f">Notes<input type="text" data-c="fv" data-k="notes" value="${esc(f.notes || '')}"></label>`}
      <div class="actions"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="manual-save">${f.attach ? 'Attach self-reported time' : 'Save manual entry'}</button></div>` };
  },
  edit() {
    const M = ui.modal, f = M.f, s = findSession(M.id);
    if (!s) return { html: '<p>Session not found.</p><div class="actions"><button class="btn" data-a="close">Close</button></div>' };
    const manual = s.source === 'manual';
    return { html: `<div class="mhead"><div><div class="small muted">${srcTags(s)}</div><h2>Edit session</h2><p class="small muted">${fmtDayLong(dayKey(s.startedAt, derive().sh))}, ${fmtTime(s.startedAt)} to ${fmtTime(s.endedAt)}</p></div><button class="x" data-a="close" aria-label="Close">×</button></div>
      ${manual ? `<div class="grid3"><label class="f">Date<input type="date" data-c="fv" data-k="date" value="${esc(f.date)}"></label><label class="f">Start time<input type="time" data-c="fv" data-k="time" value="${esc(f.time)}"></label><label class="f">Duration (minutes)<input type="number" min="1" data-c="fv" data-k="dur" value="${esc(f.dur)}"></label></div>`
        : `<div class="grid2"><label class="f">Focused minutes (timer recorded ${fmtDur(s.originalFocusSec != null ? s.originalFocusSec : s.focusSec, true)})<input type="number" min="0" data-c="fv" data-k="dur" value="${esc(f.dur)}"></label><label class="f">Your own estimate, minutes (optional)<input type="number" min="0" data-c="fv" data-k="self" value="${esc(f.self || '')}"></label></div>
        <p class="tiny muted">Correct the focused time only if the timer was wrong, for example if you forgot to pause. The original timer figure is kept and the session is marked as corrected.</p>`}
      ${pickerHTML(f)}
      <div><div class="sheet-label">What kind of study</div><div class="chips">${MODES.map(([k, l]) => chip(l, f.mode === k, `data-a="fset" data-k="mode" data-v="${k}"`)).join('')}</div></div>
      <div class="grid3"><label class="f">Questions solved<input type="number" min="0" data-c="fv" data-k="q" value="${esc(f.q || '')}"></label><label class="f">Correct<input type="number" min="0" data-c="fv" data-k="qc" value="${esc(f.qc || '')}"></label><div><div class="sheet-label">Confidence after</div>${scaleHTML('confAfter', f.confAfter)}</div></div>
      <label class="f">Notes<textarea data-c="fv" data-k="notes" style="min-height:60px">${esc(f.notes || '')}</textarea></label>
      <div class="actions">${s.status === 'discarded' ? '<button class="btn left" data-a="ses-restore">Restore session</button>' : '<button class="btn danger left" data-a="ses-discard">Discard</button>'}<button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="edit-save">Save changes</button></div>` };
  },
  report() {
    const M = ui.modal;
    return { html: `<div class="mhead"><h2>${esc(M.title)}</h2><button class="x" data-a="close" aria-label="Close">×</button></div><pre class="code" style="white-space:pre-wrap;font-family:var(--font);font-size:14.5px">${esc(M.text)}</pre>
      <div class="actions"><button class="btn" data-a="copy-text">Copy</button><button class="btn primary" data-a="report-dl">Download</button></div>`, wide: true };
  },
  text() {
    const M = ui.modal;
    return { html: `<div class="mhead"><h2>${esc(M.title)}</h2><button class="x" data-a="close" aria-label="Close">×</button></div><p class="small muted">${esc(M.note || '')}</p><textarea readonly style="min-height:260px;font-size:12.5px">${esc(M.text)}</textarea><div class="actions"><button class="btn primary" data-a="copy-text">Copy</button></div>`, wide: true };
  }
};
let modalOpenedFor = null;
function renderModal() {
  const root = $('#modal-root');
  if (!ui.modal) { root.innerHTML = ''; modalOpenedFor = null; return; }
  const fn = MODALS[ui.modal.type]; let r = null;
  try { r = fn ? fn() : null; } catch (e) { console.error(e); r = { html: `<p>Could not show this dialog: ${esc(e.message)}</p><div class="actions"><button class="btn" data-a="close">Close</button></div>` }; }
  if (!r) { ui.modal = null; root.innerHTML = ''; return; }
  const scrollEl = root.querySelector('.scrim'), st = scrollEl ? scrollEl.scrollTop : 0;
  const active = document.activeElement, activeKey = active && active.dataset ? active.dataset.k : null;
  root.innerHTML = `<div class="scrim" data-a="scrim"><div class="modal${r.wide ? ' wide' : ''}" role="dialog" aria-modal="true">${r.html}</div></div>`;
  const sc = root.querySelector('.scrim');
  if (modalOpenedFor !== ui.modal) { modalOpenedFor = ui.modal; const first = root.querySelector('input[type=text],textarea'); if (first && ui.modal.type !== 'concept' && ui.modal.type !== 'post' && window.matchMedia && matchMedia('(pointer:fine)').matches) first.focus({ preventScroll: true }); }
  else { sc.scrollTop = st; if (activeKey) { const el = root.querySelector(`[data-k="${activeKey}"]`); if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.focus({ preventScroll: true }); } }
}
function closeModal() { ui.modal = null; renderModal(); }
function askConfirm(o) { ui.modal = Object.assign({ type: 'confirm' }, o); renderModal(); }

/* =====================================================================
   ACTIONS
   ===================================================================== */
const V = el => el.dataset.v, ID = el => el.dataset.id;
function num(v, dflt) { const n = parseFloat(v); return isFinite(n) ? n : dflt; }
function afterStop(s) { ui.focus = false; if (s) openPost(s); else render(); }
function savePost() {
  const M = ui.modal, f = M.f, s = findSession(M.sid); if (!s) return null;
  if (f.notes != null) s.notes = f.notes;
  ['difficult', 'understood'].forEach(k => { if (f[k]) s[k] = f[k]; });
  if (f.focus) s.focusRating = f.focus; if (f.difficulty) s.difficulty = f.difficulty; if (f.confAfter) s.confidenceAfter = f.confAfter;
  const q = Math.round(num(f.q, 0)), qc = Math.min(q, Math.round(num(f.qc, 0)));
  if (q > 0 && !f.practiceSaved) {
    s.questionsSolved = q; s.questionsCorrect = qc;
    const cid = f.pcid || (s.conceptIds || [])[0];
    if (cid && N(cid)) addPractice({ id: uid('p'), at: s.endedAt, cid, n: q, c: qc, lv: f.lv || 'standard', ses: s.id });
    f.practiceSaved = true;
  }
  const l = s.lectureId && derive().lectures.find(x => x.id === s.lectureId);
  if (l && !f.lectureSaved) {
    const cl = core().lectures.find(x => x.id === l.id);
    if (cl) { const t = s.endedAt || Date.now(); if (f.lecWatched && !cl.watchedAt) cl.watchedAt = t; if (f.lecStudied && !cl.studiedAt) cl.studiedAt = t; cl.updatedAt = Date.now(); Store.touch('core'); }
    f.lectureSaved = true;
  }
  saveSession(s);
  return s;
}
function nlCandidates(f) {
  const d = derive(), out = [], a = core().active;
  if (a && f.date === d.today) out.push({ id: 'active', label: `The running session (${sesLabel(a)}, ${fmtDur(focusNow(a))} so far)` });
  d.live.filter(s => s.source !== 'manual' && dayKey(s.startedAt, d.sh) === f.date && (!f.subjectId || sesSubject(s) === f.subjectId || splitOf(s).some(p => p.s === f.subjectId)))
    .slice(-4).forEach(s => out.push({ id: s.id, label: `${fmtTime(s.startedAt)} timer session: ${sesLabel(s)}, tracked ${fmtDur(s.focusSec)}` }));
  return out;
}
async function nlLog(text) {
  text = (text || '').trim(); if (!text) return;
  const d = derive();
  const p = parseStudyText(text, core().nodes, d.byId, d.today);
  const f = { date: p.dateKey || d.today, time: '', dur: p.durationMin || '', examId: (activeExam() || {}).id || '', subjectId: p.subjectId || '', topicId: p.topicId || '', subtopicId: p.subtopicId || '', conceptIds: p.conceptId ? [p.conceptId] : [], mode: p.mode || 'reading', notes: text, attach: '' };
  let aiUsed = false;
  if (aiOn() && (!p.subjectId || !p.durationMin)) {
    ui.nlBusy = true; if (ui.view === 'history') renderMain();
    try {
      const lines = core().nodes.filter(n => !d.archivedChain[n.id] && d.subjOf[n.id]).map(n => `${n.id} | ${n.kind} | ${pathStr(n.id)}`).join('\n').slice(0, 40000);
      const r = await aiJson(`Read a student's study log and match it to their syllabus. Today is ${d.today}. Log: "${text}"\n\nSyllabus (id | kind | path):\n${lines}\n\nReply with only a JSON object: {"subjectId": id or null, "topicId": id or null, "subtopicId": id or null, "conceptIds": [ids], "durationMin": number or null, "date": "YYYY-MM-DD" or null, "startTime": "HH:MM" or null, "mode": one of lecture, reading, notes, recall, practice, revision, mistakes, teachback, mock, mixed, or null}. Use only ids from the list. Example: {"subjectId":"s1","topicId":"t2","subtopicId":null,"conceptIds":["c9"],"durationMin":45,"date":"${d.today}","startTime":null,"mode":"reading"}`);
      if (r && typeof r === 'object') {
        const ok = (id, kind) => id && d.byId[id] && d.byId[id].kind === kind;
        if (ok(r.subjectId, 'subject')) { f.subjectId = r.subjectId; f.topicId = ok(r.topicId, 'topic') ? r.topicId : ''; f.subtopicId = ok(r.subtopicId, 'subtopic') ? r.subtopicId : ''; f.conceptIds = (r.conceptIds || []).filter(id => ok(id, 'concept')).slice(0, 10); }
        if (!f.dur && r.durationMin > 0) f.dur = Math.round(r.durationMin);
        if (r.date && /^\d{4}-\d\d-\d\d$/.test(r.date) && r.date <= d.today) f.date = r.date;
        if (r.startTime && /^\d\d:\d\d$/.test(r.startTime)) f.time = r.startTime;
        if (r.mode && MODE_NAME[r.mode]) f.mode = r.mode;
        aiUsed = true;
      }
    } catch (e) { const m = aiErr(e); if (m) toast(m); }
    ui.nlBusy = false;
  }
  if (f.conceptIds.length && !f.topicId) { const c0 = f.conceptIds[0]; f.subjectId = f.subjectId || d.subjOf[c0] || ''; f.topicId = d.topicOf[c0] || ''; f.subtopicId = d.subtopicOf[c0] || ''; }
  if (!f.time) f.time = f.date === d.today ? pad(Math.max(0, new Date().getHours() - Math.ceil((f.dur || 30) / 60))) + ':00' : '18:00';
  const cands = nlCandidates(f);
  if (cands.length && f.date === d.today && cands[0].id === 'active') f.attach = 'active';
  ui.modal = { type: 'manual', f, nl: text, aiUsed, cands }; const box = $('#nl-box'); if (box) box.value = '';
  render();
}
function saveManual() {
  const M = ui.modal, f = M.f, d = derive();
  const dur = Math.round(num(f.dur, 0));
  if (!dur) { toast('Enter how many minutes you studied.'); return; }
  if (f.attach) {
    if (f.attach === 'active') { const a = core().active; if (a) { a.selfReportedSec = dur * 60; Store.touch('core'); toast('Noted as self-reported on the running session. The timer keeps counting.'); } }
    else { const s = findSession(f.attach); if (s) { s.selfReportedSec = dur * 60; s.selfNote = M.nl || ''; saveSession(s); toast(`Stored as self-reported next to the timer's ${fmtDur(s.focusSec)}.`); } }
    closeModal(); render(); return;
  }
  const [hh, mm] = (f.time || '18:00').split(':').map(Number);
  const dt = keyToDate(f.date || d.today); dt.setHours(hh || 0, mm || 0, 0, 0);
  const start = dt.getTime(), end = start + dur * MIN;
  if (end > Date.now() + MIN) { toast('That would end in the future. Check the date, start time and duration.'); return; }
  const q = Math.round(num(f.q, 0));
  const s = { id: uid('ss'), examId: f.examId || null, subjectId: f.subjectId || null, topicId: f.topicId || null, subtopicId: f.subtopicId || null, conceptIds: (f.conceptIds || []).slice(), startedAt: start, endedAt: end, elapsedSec: dur * 60, pausedSec: 0, breakSec: 0, idleExcludedSec: 0, focusSec: dur * 60,
    mode: f.mode || 'mixed', timerStyle: null, source: 'manual', selfReportedSec: dur * 60, notes: f.notes || '', status: 'completed', createdAt: Date.now(), questionsSolved: q || 0, questionsCorrect: Math.min(q, Math.round(num(f.qc, 0))) || 0 };
  const c = core(); s.conceptIds.forEach(cid => { if (!c.mem[cid]) c.mem[cid] = { state: 'new', due: dayStart(addDays(d.today, 1), d.sh), reps: 0, lapses: 0, ok: 0, fail: 0 }; });
  if (q && s.conceptIds[0]) addPractice({ id: uid('p'), at: end, cid: s.conceptIds[0], n: q, c: s.questionsCorrect, lv: 'standard', ses: s.id });
  saveSession(s); Store.touch('core');
  toast(`Saved ${fmtDur(s.focusSec)} as manual, self-reported study.`); closeModal(); render();
}
function openEdit(id) {
  const s = findSession(id); if (!s) return; const d = derive();
  ui.modal = { type: 'edit', id, f: { examId: s.examId || '', subjectId: s.subjectId || '', topicId: s.topicId || '', subtopicId: s.subtopicId || '', conceptIds: (s.conceptIds || []).slice(), mode: s.mode, notes: s.notes || '', q: s.questionsSolved || '', qc: s.questionsCorrect || '', confAfter: s.confidenceAfter || null,
    date: dayKey(s.startedAt, 0), time: pad(new Date(s.startedAt).getHours()) + ':' + pad(new Date(s.startedAt).getMinutes()), dur: Math.round(s.focusSec / 60), self: s.selfReportedSec && s.source !== 'manual' ? Math.round(s.selfReportedSec / 60) : '' } };
  renderModal();
}
function saveEdit() {
  const M = ui.modal, f = M.f, s = findSession(M.id); if (!s) return;
  ['examId', 'subjectId', 'topicId', 'subtopicId'].forEach(k => s[k] = f[k] || null);
  s.conceptIds = (f.conceptIds || []).slice(); s.mode = f.mode; s.notes = f.notes || '';
  s.questionsSolved = Math.round(num(f.q, 0)); s.questionsCorrect = Math.min(s.questionsSolved, Math.round(num(f.qc, 0))); if (f.confAfter) s.confidenceAfter = f.confAfter;
  const dur = Math.round(num(f.dur, 0));
  if (s.source === 'manual') {
    const [hh, mm] = (f.time || '18:00').split(':').map(Number); const dt = keyToDate(f.date); dt.setHours(hh || 0, mm || 0, 0, 0);
    s.startedAt = dt.getTime(); s.focusSec = s.elapsedSec = s.selfReportedSec = Math.max(60, dur * 60); s.endedAt = s.startedAt + s.focusSec;
  } else {
    if (dur !== Math.round(s.focusSec / 60)) { if (s.originalFocusSec == null) s.originalFocusSec = s.focusSec; s.focusSec = Math.max(0, dur * 60); s.timeEdited = true; }
    const self = Math.round(num(f.self, 0)); s.selfReportedSec = self ? self * 60 : null;
  }
  const c = core(), d = derive(); s.conceptIds.forEach(cid => { if (!c.mem[cid]) c.mem[cid] = { state: 'new', due: dayStart(addDays(d.today, 1), d.sh), reps: 0, lapses: 0, ok: 0, fail: 0 }; });
  s.edited = true; s.editedAt = Date.now(); saveSession(s); Store.touch('core'); closeModal(); render(); toast('Session updated.');
}
function exportDocs() { return JSON.stringify({ app: 'logbook', v: 1, exportedAt: new Date().toISOString(), docs: Store.docs }, null, 1); }
async function saveFile(filename, data) {
  try {
    const type = filename.endsWith('.json') ? 'application/json' : filename.endsWith('.csv') ? 'text/csv' : 'text/plain';
    const url = URL.createObjectURL(new Blob([data], { type: type + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Downloading ' + filename + '.');
  } catch (e) { ui.modal = { type: 'text', title: filename, note: 'The download did not start. Copy the text instead.', text: data }; renderModal(); }
}
function sessionsCSV() {
  const d = derive(), q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['date', 'start', 'end', 'focused_min', 'paused_min', 'source', 'status', 'edited', 'self_reported_min', 'exam', 'subject', 'topic', 'subtopic', 'concepts', 'mode', 'questions', 'correct', 'notes']];
  d.sessions.forEach(s => rows.push([dayKey(s.startedAt, d.sh), new Date(s.startedAt).toISOString(), new Date(s.endedAt).toISOString(), (s.focusSec / 60).toFixed(1), ((s.pausedSec || 0) / 60).toFixed(1), s.source || 'timer', s.status, s.timeEdited ? 'time' : s.edited ? 'yes' : '', s.selfReportedSec ? (s.selfReportedSec / 60).toFixed(0) : '',
    (core().exams.find(e => e.id === s.examId) || {}).name || '', s.subjectId ? subjName(s.subjectId) : '', s.topicId && N(s.topicId) ? N(s.topicId).name : '', s.subtopicId && N(s.subtopicId) ? N(s.subtopicId).name : '', conceptNames(s.conceptIds, 50), s.mode, s.questionsSolved || '', s.questionsCorrect || '', s.notes || '']));
  return rows.map(r => r.map(q).join(',')).join('\n');
}
function replaceAll(docs) {
  for (const id of Object.keys(Store.docs)) if (!(id in docs)) { delete Store.docs[id]; Store.dirty.add(id); Store.saveLocal(id); }
  for (const id in docs) { Store.docs[id] = docs[id]; Store.touch(id); }
  if (!Store.docs.core) Store.docs.core = freshCore();
  normalizeCore(); invalidate(); ui.rev = null; ui.modal = null; Store.touch('core', true); render();
}
function misFromForm(f, base) {
  const d = derive(), cid = (f.conceptIds || [])[0] || null;
  return Object.assign(base || { id: uid('m'), at: Date.now(), stage: 0, next: dayStart(addDays(d.today, 1), d.sh), attempts: [], resolved: false }, { q: f.q || '', cid, sid: f.subjectId || (cid ? d.subjOf[cid] : null), type: f.type || 'concept', why: f.why || '', fix: f.fix || '', remember: f.remember || '', src: f.src || '' });
}
function recallTimer(cids) { if (!core().active) { const d = derive(); const subs = [...new Set(cids.map(x => d.subjOf[x]).filter(Boolean))]; startSession({ mode: 'recall', style: 'stopwatch', conceptIds: cids, subjectId: subs.length === 1 ? subs[0] : null }); } }

const ACT = {
  nav: el => { ui.modal = null; renderModal(); go(V(el)); },
  close: () => closeModal(),
  scrim: (el, e) => { if (e.target === el && ui.modal && !ui.modal.lock) closeModal(); },
  'start-open': () => openStart(),
  'start-go': () => {
    const f = ui.modal.f; const st = STYLES.find(x => x[0] === f.style);
    startSession(Object.assign({}, f, { minutes: f.minutes || st[2] })); ui.modal = null; render();
  },
  'start-switch': () => { const s = stopSession(); if (s) toast('Saved ' + fmtDur(s.focusSec) + ' of ' + sesLabel(s) + '.'); ui.focus = false; render(); },
  'start-continue': el => { const s = findSession(ID(el)); if (!s) return; Object.assign(ui.modal.f, { examId: s.examId || '', subjectId: sesSubject(s) || '', topicId: s.topicId || '', subtopicId: s.subtopicId || '', conceptIds: (s.conceptIds || []).slice(), mode: s.mode }); renderModal(); },
  'start-subject': el => openStart({ subjectId: ID(el) }),
  'start-concept': el => { const d = derive(), id = ID(el); openStart({ subjectId: d.subjOf[id] || '', topicId: d.topicOf[id] || '', subtopicId: d.subtopicOf[id] || '', conceptIds: [id] }); },
  fset: el => { const f = ui.modal.f, k = el.dataset.k, v = V(el); f[k] = v; if (k === 'style') { const st = STYLES.find(x => x[0] === v); f.minutes = st ? st[2] || '' : ''; } if (k === 'attach' && v) { /* keep */ } renderModal(); },
  fscale: el => { const f = ui.modal.f, k = el.dataset.k, v = +V(el); f[k] = f[k] === v ? null : v; renderModal(); },
  'pk-c': el => { const f = ui.modal.f, id = ID(el); const has = f.conceptIds.includes(id); if (el.dataset.single) f.conceptIds = has ? [] : [id]; else f.conceptIds = has ? f.conceptIds.filter(x => x !== id) : f.conceptIds.concat(id).slice(0, 40); renderModal(); },
  pause: () => pauseSession('pause'),
  resume: () => resumeSession(),
  stop: () => { if (ui.modal && ui.modal.type === 'target') ui.modal = null; afterStop(stopSession()); },
  'focus-open': () => { if (core().active) { ui.focus = true; renderFocus(); } },
  'focus-close': () => { ui.focus = false; if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); renderFocus(); },
  fullscreen: () => { const r = document.documentElement; if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); else if (r.requestFullscreen) r.requestFullscreen().catch(() => toast('Full screen is not available here.')); },
  'more-open': () => { ui.modal = { type: 'more' }; renderModal(); },
  'plan-start': () => { const p = core().plan; const b = p && p.blocks.find(x => x.kind !== 'break' && !blockDone(x)); if (b) blockStart(b.key); else toast("Today's plan is done. Anything more is a bonus."); },
  'plan-rebuild': () => { ensurePlan(true, (core().plan || {}).avail); render(); toast('Plan rebuilt around what is left today.'); },
  'block-start': el => blockStart(el.dataset.k),
  'block-done': el => {
    const p = core().plan; if (!p) return; p.done = p.done || {}; const k = el.dataset.k; const b = p.blocks.find(x => x.key === k); if (!b) return;
    if (blockDone(b)) { delete p.done[k]; if (b.status === 'done') b.status = 'todo'; if ((p.progress[k] || 0) >= b.min * 0.8) p.progress[k] = 0; }
    else {
      p.done[k] = true; b.status = 'done';
      // Completing a lecture task by hand counts as that step of the lecture (a partial watch does not).
      const l = b.lectureId && core().lectures.find(x => x.id === b.lectureId);
      if (l && !/^Watch part/.test(b.title)) { const t = Date.now(); if (b.kind === 'lecture' && !l.watchedAt) l.watchedAt = t; if (b.kind === 'selfstudy' && !l.studiedAt) l.studiedAt = t; if ((b.kind === 'recall' || b.kind === 'review') && !l.recalledAt && l.watchedAt) l.recalledAt = t; l.updatedAt = t; }
    }
    Store.touch('core'); render();
  },
  'post-qlog': () => { const s = savePost(); const cid = s && ((ui.modal.f || {}).pcid || (s.conceptIds || [])[0]); ui.modal = null; PREP.openQuestion({ conceptId: cid || '', subjectId: s ? sesSubject(s) || '' : '', sessionId: s ? s.id : null }); },
  'day-open': el => { ui.modal = { type: 'day', k: el.dataset.k }; renderModal(); },
  concept: el => { ui.modal = { type: 'concept', id: ID(el), tab: el.dataset.tab || 'prompts', f: {} }; renderModal(); },
  'cn-tab': el => { ui.modal.tab = V(el); ui.modal.aiErr = ''; renderModal(); },
  'ses-edit': el => openEdit(ID(el)),
  // review
  'rev-subj': el => { ui.revOpt.subj = V(el); renderMain(); },
  'rev-mixed': () => { ui.revOpt.mixed = !ui.revOpt.mixed; renderMain(); },
  'rev-go': () => { const o = ui.revOpt; const list = planCtx(0).due.filter(x => !o.subj || x.sid === o.subj).slice(0, o.count).map(x => x.cid); if (!list.length) return; recallTimer(list); beginReview(list, { mixed: o.mixed }); render(); },
  'rev-recent': () => { const d = derive(), ctx = planCtx(0); const ids = liveConcepts().filter(cn => d.cinfo[cn.id].state >= 1 && !ctx.due.some(x => x.cid === cn.id)).sort((a, b) => ((d.cinfo[b.id].ix.sessions.slice(-1)[0] || {}).startedAt || 0) - ((d.cinfo[a.id].ix.sessions.slice(-1)[0] || {}).startedAt || 0)).slice(0, 8).map(x => x.id); recallTimer(ids); beginReview(ids, { mixed: ui.revOpt.mixed }); render(); },
  'recall-one': el => { const id = ID(el); ui.modal = null; beginReview([id], {}); renderModal(); if (ui.view !== 'review') go('review'); else renderMain(); },
  'rev-quit': () => { if (ui.rev && ui.rev.results.length) ui.rev.phase = 'done'; else ui.rev = null; renderMain(); },
  'rev-close': () => { ui.rev = null; renderMain(); renderNav(); },
  'rev-conf': el => { const v = +V(el); ui.rev.conf = ui.rev.conf === v ? null : v; const t = $('#rev-answer'); if (t) ui.rev.answer = t.value; renderMain(); },
  'rev-hint': () => { ui.rev.hint = true; ui.rev.showHint = true; const t = $('#rev-answer'); if (t) ui.rev.answer = t.value; renderMain(); },
  'rev-reveal': () => { const r = ui.rev; if (!r || r.phase !== 'prompt') return; const t = $('#rev-answer'); if (t) r.answer = t.value; r.revealedAt = Date.now(); r.phase = 'answer'; renderMain(); },
  'rev-out': el => { ui.rev.outcome = ui.rev.outcome === V(el) ? null : V(el); renderMain(); },
  'rev-grade': el => { gradeCard(+V(el)); renderMain(); renderNav(); window.scrollTo(0, 0); },
  'rev-prereq': () => { const r = ui.rev, n = N(r.recoverCid); const pre = (n.prereq || []).filter(id => N(id)); r.queue.splice(r.i + 1, 0, ...pre); r.phase = 'prompt'; nextCard(); renderMain(); },
  'rev-continue': () => { nextCard(); renderMain(); },
  'rev-reexplain': async () => {
    const r = ui.rev, n = N(r.recoverCid); if (!n || r.reexplainBusy) return; r.reexplainBusy = true; renderMain();
    try {
      const res = await aiText(`A student preparing for ${(activeExam() || {}).name || 'an exam'} keeps forgetting this concept: "${n.name}" (${pathStr(n.id)}).${n.notes ? ' Their notes: ' + n.notes.slice(0, 1500) : ''}\nExplain it simply in under 170 words: the core idea, why it works, the one formula or rule to remember if there is one, and a common confusion to avoid. Then give one easy recall question on a new line starting with "Try:". Plain text, no markdown.`, { onText: ({ text }) => { const el = $('#reexplain'); if (el) { el.className = 'answer'; el.textContent = text; } } });
      r.reexplain = res.text;
    } catch (e) { r.reexplain = (e && e.text) || aiErr(e); }
    r.reexplainBusy = false; renderMain();
  },
  // subjects
  'subj-listtab': el => { ui.subj.listTab = V(el); renderMain(); },
  'subj-exam': el => { ui.subj.exam = V(el); renderMain(); },
  'subj-arch': () => { ui.subj.showArch = !ui.subj.showArch; renderMain(); },
  'subj-tab': el => { ui.subj.tab = V(el); renderMain(); },
  'subj-add': () => { const n = derive().subjects.length; ui.modal = { type: 'subject', f: { name: '', examIds: activeExam() ? [activeExam().id] : [], imp: 2, diff: 2, priority: 2, share: '', color: PALETTE[n % PALETTE.length], desc: '', prereqSubjects: [] } }; renderModal(); },
  'subj-edit': el => { const s = N(ID(el)); ui.modal = { type: 'subject', id: s.id, f: { name: s.name, examIds: (s.examIds || []).slice(), imp: s.imp || 2, diff: s.diff || 2, priority: s.priority || 2, share: s.share || '', estHours: s.estHours || '', targetDate: s.targetDate || '', color: s.color || PALETTE[0], desc: s.desc || '', prereqSubjects: (s.prereqSubjects || []).slice() } }; renderModal(); },
  'subj-pre-t': el => { const f = ui.modal.f, id = ID(el); f.prereqSubjects = (f.prereqSubjects || []).includes(id) ? f.prereqSubjects.filter(x => x !== id) : (f.prereqSubjects || []).concat(id); renderModal(); },
  'subj-exam-t': el => { const f = ui.modal.f, id = ID(el); f.examIds = f.examIds.includes(id) ? f.examIds.filter(x => x !== id) : f.examIds.concat(id); renderModal(); },
  'subj-save': () => {
    const M = ui.modal, f = M.f, name = (f.name || '').trim(); if (!name) { toast('Give the subject a name.'); return; }
    if (f.targetDate && !isDateKey(f.targetDate)) { toast('The target date is not a valid date.'); return; }
    const vals = { name, examIds: f.examIds, imp: +f.imp || 2, diff: +f.diff || 2, priority: +f.priority || 2, share: Math.max(0, num(f.share, 0)), estHours: Math.max(0, num(f.estHours, 0)) || null,
      targetDate: f.targetDate || null, prereqSubjects: (f.prereqSubjects || []).slice(), color: f.color, desc: f.desc || '' };
    if (M.id) { Object.assign(core().nodes.find(n => n.id === M.id), vals); Store.touch('core'); } else addNode('subject', null, name, vals);
    closeModal(); render();
  },
  'roadmap-apply': () => { applyRoadmapOrder(); render(); },
  'node-move': el => { moveNode(ID(el), +V(el)); render(); },
  'node-add': el => { ui.modal = { type: 'node', kind: el.dataset.kind, parentId: ID(el), f: { name: '' } }; renderModal(); },
  'node-edit': el => { const n = N(ID(el)); ui.modal = { type: 'node', id: n.id, kind: n.kind, parentId: n.parentId, f: { name: n.name } }; renderModal(); },
  'node-save': () => {
    const M = ui.modal, raw = M.f.name || '';
    if (M.id) { const n = core().nodes.find(x => x.id === M.id); if (n && raw.trim()) { n.name = raw.trim(); Store.touch('core'); } }
    else { const names = (M.kind === 'concept' ? raw.split('\n') : [raw]).map(x => x.trim()).filter(Boolean); if (!names.length) { toast('Enter a name.'); return; } names.forEach(nm => addNode(M.kind, M.parentId, nm)); }
    closeModal(); render();
  },
  'topic-add': el => { const inp = $('#new-topic'); const v = inp && inp.value.trim(); if (!v) return; addNode('topic', ID(el), v); render(); const i2 = $('#new-topic'); if (i2) i2.focus(); },
  'node-archive': el => { const n = core().nodes.find(x => x.id === ID(el)); if (!n) return; n.archived = !n.archived; Store.touch('core'); toast(n.archived ? 'Archived. History and time stay; it leaves plans and reviews.' : 'Restored.'); render(); },
  'node-del': el => {
    const id = ID(el), n = N(id); if (!n) return; const cs = n.kind === 'concept' ? [n] : conceptsUnder(id);
    askConfirm({ title: 'Delete ' + n.name + '?', text: `This removes it${cs.length > 1 ? ' and ' + cs.length + ' concepts under it' : ''}, with their review schedules. Past sessions keep their time but will show as a removed item. Archiving keeps everything and only hides it.`, yes: 'Delete', danger: true,
      fn: () => { removeNode(id); if (ui.view === 'subject' && ui.param === id) go('subjects'); render(); } });
  },
  'confirm-yes': () => { const M = ui.modal; if (M.typeWord && ((M.f || {}).word || '').trim().toUpperCase() !== M.typeWord) { toast('Type ' + M.typeWord + ' to confirm.'); return; } ui.modal = null; renderModal(); M.fn && M.fn(); },
  // concept modal
  'pr-add': () => { const M = ui.modal, f = M.f; if (!(f.pq || '').trim()) { toast('Write the question first.'); return; } setPrompts(M.id, promptsFor(M.id).concat({ id: uid('q'), kind: f.pk || 'free', q: f.pq.trim(), a: (f.pa || '').trim(), hint: (f.ph || '').trim() })); f.pq = f.pa = f.ph = ''; renderModal(); },
  'pr-del': el => { const M = ui.modal; setPrompts(M.id, promptsFor(M.id).filter(p => p.id !== el.dataset.pid)); renderModal(); },
  'pr-draft-add': el => { const M = ui.modal, p = M.drafts[+V(el)]; setPrompts(M.id, promptsFor(M.id).concat({ id: uid('q'), kind: PK_NAME[p.kind] ? p.kind : 'free', q: p.q, a: p.a || '', hint: p.hint || '' })); M.drafts.splice(+V(el), 1); renderModal(); },
  'pr-ai': async () => {
    const M = ui.modal, n = N(M.id); if (M.busy) return; M.busy = true; M.aiErr = ''; renderModal();
    try {
      const r = await aiJson(`Write 4 active-recall prompts for a student preparing for ${(activeExam() || {}).name || 'an exam'}. Concept: "${n.name}" (${pathStr(n.id)}).${n.notes ? ' Student notes: ' + n.notes.slice(0, 1200) : ''}\nMix kinds from: free, formula, explain, compare, application, problem. Each answer must be short, correct and checkable. Reply with only a JSON array of objects {"kind","q","a","hint"}. Example: [{"kind":"explain","q":"Why does X happen?","a":"Because …","hint":"Think about …"}]`);
      M.drafts = (Array.isArray(r) ? r : []).filter(p => p && p.q).slice(0, 6);
      if (!M.drafts.length) M.aiErr = 'No usable prompts came back. Try again.';
    } catch (e) { M.aiErr = aiErr(e); }
    M.busy = false; if (ui.modal === M) renderModal();
  },
  'pa-add': () => {
    const M = ui.modal, f = M.f, n = Math.round(num(f.pn, 0)), c = Math.round(num(f.pc, 0));
    if (n < 1 || c < 0 || c > n) { toast('Enter questions tried and how many were correct.'); return; }
    addPractice({ id: uid('p'), at: Date.now(), cid: M.id, n, c, lv: f.lv || 'standard', min: num(f.pmin, 0) || null, src: f.psrc || '' });
    const cm = core().mem; if (!cm[M.id]) { const d = derive(); cm[M.id] = { state: 'new', due: dayStart(addDays(d.today, 1), d.sh), reps: 0, lapses: 0, ok: 0, fail: 0 }; Store.touch('core'); }
    f.pn = f.pc = f.pmin = ''; toast('Practice logged.'); renderModal();
  },
  'tb-self': el => { const M = ui.modal, t = (M.f.tb || '').trim(); if (!t) { toast('Write your explanation first.'); return; } addTeach({ id: uid('tb'), at: Date.now(), cid: M.id, text: t, score: +V(el), ai: false }); M.f.tb = ''; toast('Teach-back saved.'); renderModal(); },
  'tb-ai': async () => {
    const M = ui.modal, n = N(M.id), t = (M.f.tb || '').trim(); if (!t) { toast('Write your explanation first.'); return; } if (M.busy) return;
    M.busy = true; M.aiErr = ''; renderModal();
    try {
      const r = await aiJson(`You are checking a student's teach-back explanation. They are preparing for ${(activeExam() || {}).name || 'an exam'}. Concept: "${n.name}" (${pathStr(n.id)}).\nStudent explanation:\n"""${t.slice(0, 6000)}"""\nJudge only technical accuracy and completeness. Reply with only a JSON object: {"score": 0-100, "correct": [short strings], "missing": [short strings], "misconceptions": [short strings], "relationships": [links to other concepts worth making], "next": "one sentence on what to do next"}. Example: {"score":70,"correct":["States the main rule"],"missing":["No example of when it applies"],"misconceptions":[],"relationships":["Connect to the related concept"],"next":"Recall the missing part tomorrow."}`);
      if (!r || typeof r.score !== 'number') throw { code: 'invalid_json' };
      r.score = Math.round(clamp(r.score, 0, 100)); M.tbRes = r;
      addTeach({ id: uid('tb'), at: Date.now(), cid: M.id, text: t, score: r.score, ai: true, res: r });
    } catch (e) { M.aiErr = aiErr(e); }
    M.busy = false; if (ui.modal === M) renderModal();
  },
  'res-add': () => { const M = ui.modal, f = M.f; if (!(f.rt || f.ru || '').trim()) { toast('Add a title or link.'); return; } const n = core().nodes.find(x => x.id === M.id); n.resources = (n.resources || []).concat({ id: uid('rs'), kind: f.rk || 'Video', title: (f.rt || '').trim(), url: (f.ru || '').trim() }); f.rt = f.ru = ''; Store.touch('core'); renderModal(); },
  'res-del': el => { const n = core().nodes.find(x => x.id === ui.modal.id); n.resources = (n.resources || []).filter(r => r.id !== el.dataset.rid); Store.touch('core'); renderModal(); },
  'pre-add': () => { const M = ui.modal, p = M.f.newPre; if (!p) return; const n = core().nodes.find(x => x.id === M.id); n.prereq = [...new Set((n.prereq || []).concat(p))]; M.f.newPre = ''; Store.touch('core'); renderModal(); },
  'pre-del': el => { const n = core().nodes.find(x => x.id === ui.modal.id); n.prereq = (n.prereq || []).filter(x => x !== el.dataset.pid); Store.touch('core'); renderModal(); },
  'cn-save': () => { const M = ui.modal, f = M.f, n = core().nodes.find(x => x.id === M.id); if (f.nm != null && f.nm.trim()) n.name = f.nm.trim(); if (f.fo != null) n.formula = f.fo; if (f.no != null) n.notes = f.no; if (f.im != null) { if (f.im) n.imp = +f.im; else delete n.imp; } Store.touch('core'); toast('Saved.'); M.f = {}; renderModal(); },
  'mem-reset': () => { const id = ui.modal.id; askConfirm({ title: 'Reset the review schedule?', text: 'The concept will be treated as new for scheduling. Your past recall and practice records stay in history.', yes: 'Reset', fn: () => { delete core().mem[id]; Store.touch('core'); render(); } }); },
  // mistakes
  'mis-filter': el => { ui.mis.filter = V(el); renderMain(); },
  'mis-add': el => { const d = derive(), cid = el.dataset.cid; ui.modal = { type: 'mistake', f: { q: '', examId: (activeExam() || {}).id || '', subjectId: cid ? d.subjOf[cid] || '' : '', topicId: cid ? d.topicOf[cid] || '' : '', subtopicId: cid ? d.subtopicOf[cid] || '' : '', conceptIds: cid ? [cid] : [], type: 'concept' } }; renderModal(); },
  'mis-open': el => { ui.modal = { type: 'retry', id: ID(el), shown: false }; renderModal(); },
  'mis-edit': el => { const x = derive().mistakes.find(m => m.id === ID(el)); const d = derive(); ui.modal = { type: 'mistake', id: x.id, f: { q: x.q, examId: '', subjectId: x.sid || (x.cid ? d.subjOf[x.cid] : '') || '', topicId: x.cid ? d.topicOf[x.cid] || '' : '', subtopicId: x.cid ? d.subtopicOf[x.cid] || '' : '', conceptIds: x.cid ? [x.cid] : [], type: x.type, why: x.why, fix: x.fix, remember: x.remember, src: x.src } }; renderModal(); },
  'mis-save': () => { const M = ui.modal, f = M.f; if (!(f.q || '').trim() && !(f.why || '').trim()) { toast('Describe the question or what went wrong.'); return; } const base = M.id ? derive().mistakes.find(m => m.id === M.id) : null; saveMistake(misFromForm(f, base)); closeModal(); render(); toast(M.id ? 'Mistake updated.' : 'Logged. First retry tomorrow.'); },
  'mis-del': () => { const id = ui.modal.id; askConfirm({ title: 'Delete this mistake?', text: 'It will be removed from retries and statistics.', yes: 'Delete', danger: true, fn: () => { const r = findIn('mis-', 'items', id); if (r) { r.arr[r.i] = { id, gone: true, updatedAt: Date.now() }; Store.touch(r.docId); } render(); } }); },
  'mis-retry-next': () => { const x = misDue()[0]; if (x) { ui.modal = { type: 'retry', id: x.id, shown: false }; renderModal(); } },
  'retry-reveal': () => { ui.modal.shown = true; renderModal(); },
  'retry-res': el => {
    const x = derive().mistakes.find(m => m.id === ui.modal.id), d = derive(), v = V(el);
    // A mistake from a saved question: retrying the same question also updates that question's memory (stage 3 uses a similar problem instead).
    if (x.qid && d.qById[x.qid] && (x.stage || 0) !== 2) PREP.recordQuestionResult(x.qid, v === 'right' ? 'correct' : v === 'partly' ? 'partial' : 'incorrect', { fromMistake: true });
    x.attempts = (x.attempts || []).concat({ at: Date.now(), r: v, stage: x.stage || 0 });
    if (v === 'right') { x.stage = (x.stage || 0) + 1; if (x.stage >= RETRY_STAGES.length) { x.resolved = true; x.resolvedAt = Date.now(); } else x.next = dayStart(addDays(d.today, RETRY_STAGES[x.stage][0]), d.sh); }
    else if (v === 'partly') x.next = dayStart(addDays(d.today, 1), d.sh);
    else { x.stage = 0; x.next = dayStart(addDays(d.today, 1), d.sh); }
    saveMistake(x);
    toast(x.resolved ? 'Resolved after four successful retries.' : v === 'right' ? 'Next: ' + RETRY_STAGES[x.stage][1].toLowerCase() + ' ' + relDue(x.next) + '.' : 'Back tomorrow.');
    const nx = misDue().find(m => m.id !== x.id); ui.modal = nx ? { type: 'retry', id: nx.id, shown: false } : null; render();
  },
  // history
  'hist-disc': () => { ui.hist.showDiscarded = !ui.hist.showDiscarded; renderMain(); },
  'manual-open': () => { const d = derive(), t0 = new Date(Date.now() - 60 * MIN); ui.modal = { type: 'manual', f: { date: dayKey(t0.getTime(), 0), time: pad(t0.getHours()) + ':' + pad(t0.getMinutes()), dur: 60, examId: (activeExam() || {}).id || '', subjectId: '', topicId: '', subtopicId: '', conceptIds: [], mode: 'reading', attach: '' } }; renderModal(); },
  'manual-save': () => saveManual(),
  'nl-log': () => { const b = $('#nl-box'); if (b && b.value.trim() && !ui.nlBusy) nlLog(b.value); },
  'edit-save': () => saveEdit(),
  'ses-discard': () => { const s = findSession(ui.modal.id); if (!s) return; askConfirm({ title: 'Discard this session?', text: `${fmtDur(s.focusSec)} will stop counting in totals. The record is kept and can be restored from History (Show discarded).`, yes: 'Discard', danger: true, fn: () => { s.prevStatus = s.status; s.status = 'discarded'; s.discardedAt = Date.now(); saveSession(s); render(); } }); },
  'ses-restore': () => { const s = findSession(ui.modal.id); if (!s) return; s.status = s.prevStatus || 'stopped'; saveSession(s); closeModal(); render(); toast('Session restored.'); },
  // post-session
  'post-finish': () => { savePost(); ui.modal = null; render(); },
  'post-recall': () => { const s = savePost(); ui.modal = null; if (s && s.conceptIds.length) { recallTimer(s.conceptIds); beginReview(s.conceptIds, {}); go('review'); } render(); },
  'post-practice': () => { const s = savePost(); ui.modal = null; if (s) { startSession({ examId: s.examId, subjectId: s.subjectId, topicId: s.topicId, subtopicId: s.subtopicId, conceptIds: s.conceptIds, mode: 'practice', style: 'stopwatch' }); toast('Practice timer started. Log questions and accuracy when you stop.'); } render(); },
  'post-discard': () => { const id = ui.modal.sid; askConfirm({ title: 'Discard this session?', text: 'It will not count toward any totals. You can restore it from History.', yes: 'Discard', danger: true, fn: () => { const s = findSession(id); if (s) { s.prevStatus = s.status; s.status = 'discarded'; saveSession(s); } render(); } }); },
  // idle / target
  'idle-keep': () => { closeModal(); beat(); },
  'idle-remove': () => { const a = core().active, M = ui.modal; if (a && M.from) { a.idleSec = (a.idleSec || 0) + M.gapSec; Store.touch('core', true); toast('Removed ' + fmtDur(M.gapSec) + ' from this session.'); } closeModal(); beat(); renderDock(); },
  'idle-stopat': () => { const M = ui.modal; ui.modal = null; afterStop(stopSession(M.from)); },
  'idle-end': () => { const M = ui.modal, v = (M.f || {}).end || toLocalInput(M.from || Date.now()); const ts = new Date(v).getTime(); if (!isFinite(ts)) { toast('Pick a valid time.'); return; } ui.modal = null; afterStop(stopSession(ts)); },
  // insights / reports
  'ins-range': el => { ui.ins.range = V(el); renderMain(); },
  'report-open': el => { const r = buildReport(V(el)); ui.modal = { type: 'report', title: r.title, text: r.text, name: 'logbook-' + V(el) + 'ly-report-' + derive().today + '.txt' }; renderModal(); },
  'report-dl': () => saveFile(ui.modal.name, ui.modal.text),
  'copy-text': async () => { try { await navigator.clipboard.writeText(ui.modal.text); toast('Copied.'); } catch (e) { const t = $('#modal-root textarea') || null; if (t) { t.select(); toast('Press Ctrl+C to copy.'); } else toast('Copy is not available here.'); } },
  // coach
  'coach-send': () => { const i = $('#coach-in'); const q = i && i.value.trim(); if (!q) return; i.value = ''; coachAsk(q); },
  'coach-chip': el => coachAsk(V(el)),
  'coach-ai': () => coachAsk('', true),
  'coach-stop': () => { if (ui.coach.ctl) ui.coach.ctl.abort(); },
  'coach-clear': () => { ui.coach.msgs = []; renderMain(); },
  'coach-useplan': el => { ensurePlan(true, +V(el)); toast("Today's plan updated."); go('today'); },
  'coach-review': el => { const ids = V(el).split(',').filter(id => N(id)); recallTimer(ids); beginReview(ids, { mixed: true }); go('review'); render(); },
  // calendar
  'cal-tab': el => { ui.cal.tab = V(el); renderMain(); },
  'cal-day': el => { ui.cal.sel = ui.cal.sel === V(el) ? null : V(el); renderMain(); },
  'cal-month': el => { const d = derive(); const v = +V(el); if (!v) { ui.cal.month = null; renderMain(); return; } const cur = (ui.cal.month || d.today.slice(0, 7)) + '-01'; const dt = keyToDate(cur); dt.setMonth(dt.getMonth() + v); ui.cal.month = ymd(dt).slice(0, 7); renderMain(); },
  // settings
  'exam-add': () => { const n = ($('#exam-new-name') || {}).value || '', dt = ($('#exam-new-date') || {}).value || ''; if (!n.trim()) { toast('Name the exam.'); return; } const c = core(); const ex = { id: uid('e'), name: n.trim(), date: dt, archived: false }; c.exams.push(ex); if (!c.settings.activeExamId) c.settings.activeExamId = ex.id; Store.touch('core'); render(); },
  'exam-active': el => { core().settings.activeExamId = ID(el); Store.touch('core'); ensurePlan(true); render(); },
  'exam-archive': el => { const e = core().exams.find(x => x.id === ID(el)); e.archived = !e.archived; if (e.archived && core().settings.activeExamId === e.id) core().settings.activeExamId = null; Store.touch('core'); render(); },
  'exam-del': el => { const id = ID(el), e = core().exams.find(x => x.id === id); askConfirm({ title: 'Delete ' + e.name + '?', text: 'Subjects stay, but lose their link to this exam. Sessions keep their time.', yes: 'Delete', danger: true, fn: () => { const c = core(); c.exams = c.exams.filter(x => x.id !== id); c.nodes.forEach(n => { if (n.examIds) n.examIds = n.examIds.filter(x => x !== id); }); if (c.settings.activeExamId === id) c.settings.activeExamId = null; Store.touch('core'); render(); } }); },
  'planner-reset': () => { const S = core().settings; S.mix = clone(DEFAULT_MIX); S.weights = clone(DEFAULT_WEIGHTS); Store.touch('core'); render(); toast('Planner defaults restored.'); },
  'export-json': () => PREP.exportCopy(),
  'export-csv': () => saveFile('logbook-sessions-' + derive().today + '.csv', sessionsCSV(), 'Sessions CSV'),
  'reset-all': () => askConfirm({ title: 'Erase everything?', text: 'All sessions, syllabus, reviews and settings will be deleted from this browser and your account. Export a backup first if you might want it.', yes: 'Erase everything', danger: true, typeWord: 'ERASE', fn: async () => {
    // Unlink the preparation file first so autosave can never overwrite it with an empty preparation.
    if (FS) await FS.forget();
    if (core().active) { core().active = null; } replaceAll({}); go('today'); toast('Everything in this browser was erased. The progress file on your computer was unlinked, not deleted.'); } })
};

const CHG = {
  fv: el => { if (!ui.modal) return; if (!ui.modal.f) ui.modal.f = {}; ui.modal.f[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; },
  pk: (el, e) => {
    if (e.type !== 'change') return; const f = ui.modal.f, k = el.dataset.k; f[k] = el.value;
    if (k === 'examId') { f.subjectId = ''; f.topicId = ''; f.subtopicId = ''; f.conceptIds = []; }
    if (k === 'subjectId') { f.topicId = ''; f.subtopicId = ''; f.conceptIds = []; }
    if (k === 'topicId') { f.subtopicId = ''; f.conceptIds = []; }
    if (k === 'subtopicId') f.conceptIds = [];
    renderModal();
  },
  'plan-avail': (el, e) => { if (e.type !== 'change') return; ensurePlan(true, +el.value); render(); },
  'rev-count': (el, e) => { if (e.type !== 'change') return; ui.revOpt.count = +el.value; renderMain(); },
  'rev-answer': el => { if (ui.rev) ui.rev.answer = el.value; },
  'mis-type': (el, e) => { if (e.type !== 'change') return; ui.mis.type = el.value; renderMain(); },
  hist: (el, e) => { const k = el.dataset.k; if (k === 'q' && e.type === 'input') { ui.hist.q = el.value; clearTimeout(CHG.t); CHG.t = setTimeout(() => { renderMain(); const i = document.querySelector('[data-c="hist"][data-k="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 350); return; } if (e.type !== 'change') return; ui.hist[k] = el.value; renderMain(); },
  'ins-date': (el, e) => { if (e.type !== 'change') return; ui.ins[el.dataset.k] = el.value; renderMain(); },
  set: (el, e) => {
    if (e.type !== 'change') return; const S = core().settings, k = el.dataset.k, t = el.dataset.t;
    let v = t === 'bool' ? el.checked : t === 'num' ? num(el.value, null) : t === 'pct' ? num(el.value, 0) / 100 : el.value;
    if (v === null) return;
    if (k === 'dayStartHour' || k === 'idleMin' || k.startsWith('pomo.') || k.startsWith('goal.')) v = Math.max(0, Math.round(v));
    setPath(S, k, v);
    if (k === 'theme') applyTheme();
    Store.touch('core'); invalidate();
    if (['dailyMin', 'avail', 'retention', 'dayStartHour', 'capToExam', 'minPerReview'].includes(k) || k.startsWith('mix.') || k.startsWith('weights.')) { const p = core().plan; if (p && k !== 'avail' && k !== 'dailyMin') ensurePlan(true, p.avail); }
    toast('Saved.');
  },
  'exam-f': (el, e) => { if (e.type !== 'change') return; const ex = core().exams.find(x => x.id === ID(el)); if (!ex) return; ex[el.dataset.k] = el.value; Store.touch('core'); invalidate(); renderNav(); toast('Saved.'); },
  /* Any preparation file, old full backup, or the separate data files of the old storage (select several). */
  import: async (el, e) => { if (e.type !== 'change') return; await PREP.importFiles(el.files); el.value = ''; }
};

/* =====================================================================
   EVENTS, KEYBOARD, STARTUP
   ===================================================================== */
function onClick(e) {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a, fn = ACT[a]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.disabled) return;
  try { const r = fn(el, e); if (r && r.catch) r.catch(err => console.error(err)); } catch (err) { console.error(err); toast('Something went wrong. Your data is safe.'); }
}
function onField(e) {
  const el = e.target.closest ? e.target.closest('[data-c]') : null; if (!el) return;
  const fn = CHG[el.dataset.c]; if (!fn) return;
  try { fn(el, e); } catch (err) { console.error(err); }
}
function typing(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable); }
function onKey(e) {
  const t = e.target;
  if (typing(t)) {
    if (e.key === 'Enter' && t.dataset.enter && t.tagName === 'INPUT') { e.preventDefault(); const fn = ACT[t.dataset.enter]; if (fn) fn(t, e); }
    else if (e.key === 'Escape') t.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (t && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  if (e.key === 'Escape') { if (ui.modal && !ui.modal.lock) { closeModal(); return; } if (ui.focus) { ACT['focus-close'](); return; } return; }
  if (ui.modal) return;
  const r = ui.rev;
  if (ui.view === 'review' && r && r.queue.length) {
    if (r.phase === 'prompt' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); ACT['rev-reveal'](); return; }
    if (r.phase === 'prompt' && e.key === 'h') { ACT['rev-hint'](); return; }
    if (r.phase === 'answer' && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); gradeCard(+e.key); renderMain(); renderNav(); window.scrollTo(0, 0); return; }
  }
  const a = core().active;
  if (e.key === 'n' && !a) { e.preventDefault(); openStart(); }
  else if (e.key === 'p' && a) { a.pausedAt ? resumeSession() : pauseSession('pause'); renderNav(); }
  else if (e.key === 'f' && a) { ui.focus = !ui.focus; renderFocus(); }
}
let mounted = false;
export function mountLogbook(cfg) {
  if (mounted) return; mounted = true;
  CFG = cfg || {};
  CFG.server = !!CFG.server;
  LS = 'lb1:' + (CFG.uid || 'local') + ':';
  CAP.ai = CFG.ai ? 'on' : 'off';
  Object.assign(ACT, PREP.ACT); Object.assign(CHG, PREP.CHG); Object.assign(MODALS, PREP.MODALS);
  Store.loadLocal(); normalizeCore(); routeFromHash();
  if (Store.adopted) setTimeout(() => toast('Loaded the data this browser kept from your earlier sign-in. Save it to a preparation file to keep it safe.'), 600);
  FS = new FileSync({ kv: idbKV(), pickers: browserPickers(), getDocs: () => Store.docs, applyDocs: (docs, mode) => Store.setDocs(docs, mode), workspaceId: () => core().wsid,
    onStatus: st => { setSaveStatus(); if (st.message && st.message !== ui.fsMsg && /merged|Converted/.test(st.message)) toast(st.message); ui.fsMsg = st.message; } });
  ui.lastDay = derive().today;
  document.addEventListener('click', onClick);
  document.addEventListener('input', e => { const el = e.target.closest ? e.target.closest('[data-c]') : null; if (el && ['fv', 'rev-answer', 'hist', 'wiz', 'wiz-s', 'wiz-l', 'qsearch', 'qrev-f', 'syl-text'].includes(el.dataset.c)) onField(e); });
  document.addEventListener('change', onField);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { if (skipHash && skipHash === location.hash) { skipHash = null; return; } skipHash = null; routeFromHash(); if (ui.modal && ui.modal.type === 'more') ui.modal = null; renderNav(); renderMain(); renderModal(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (core().active) beat(); if (Store.remote) Store.flush(); FS.flush(); }
    else { tick(); invalidate(); if (derive().today !== ui.lastDay) { ui.lastDay = derive().today; if (!ui.modal && !ui.rev) render(); } }
  });
  window.addEventListener('pagehide', () => { if (core().active) beat(); if (Store.remote) Store.flushOnExit(); FS.flush(); });
  window.addEventListener('online', () => { if (!CFG.server) return; if (Store.remote) Store.flush(); else Store.connect(); });
  render();
  // The linked preparation file (if any). The page works from the browser copy meanwhile.
  FS.init().then(async st => {
    if (st.state === 'nofile' && !derive().subjects.length && !derive().sessions.length) {
      const r = await FS.recovery('last');
      if (r && r.docs && r.docs.core) { Store.setDocs(r.docs, 'replace'); toast('Restored your preparation from this browser’s recovery copy.'); }
    }
    setSaveStatus();
  }).catch(e => { console.error(e); setSaveStatus(); });
  if (CFG.sw && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
  setInterval(tick, 1000);
  setInterval(() => { const k = dayKey(Date.now(), core().settings.dayStartHour); if (k !== ui.lastDay) { ui.lastDay = k; invalidate(); if (!ui.modal && !ui.rev && !typing(document.activeElement)) render(); } }, 60000);
  resumeCheck();
  Store.connect();
}

/* Shared with client/prep-ui.js (the setup wizard, dashboard, roadmap, lectures and practice views). */
export {
  $, esc, clone, plural, pct, uid, sum, addDays, daysBetween, dayKey, dayStart, keyToDate, fmtDur, fmtClock, fmtTime, fmtDate, fmtDay, fmtDayLong, DAY, HOUR, MIN,
  Memory, STATES, DEFAULT_SETTINGS, KIND_NAME, PHASE_TEXT, MISTAKE_TYPES, MT_NAME, PALETTE, LEVELS, MODE_NAME,
  CFG, Store, FS, ui, N, core, derive, model, makeSnapshot, planCtx, normMix, activeExam, daysLeft, examSubjects, conceptsUnder, liveConcepts, isLiveConcept, impOf,
  pathStr, subjColor, subjName, conceptNames, sesLabel, sesSubject, sesRow, todayLearning, planBlockSub, studiedSec, availOn, windowsOn, subjectsPerDayOn, extraPerDay,
  openMistakes, questionSubject, missedInfo, ensurePlan, projectWeek, rebaseline, blockDone, blockDoneIn, blockStart, dayOptsFor, nowMinOfDay, rolloverPlans,
  saveQuestion, addQAttempt, removeQuestion, saveMistake, addPractice, addReview, memOpts, maxIvlNow, misDue, dueCount, riskList, focusNow, startSession, openStart,
  toast, go, render, renderMain, renderModal, renderNav, closeModal, askConfirm, saveStatusInfo, setSaveStatus, freshCore, replaceAll, saveFile, exportDocs,
  chip, opt, stat, hbar, dot, stateTag, pickerHTML, scaleHTML, relDue, greeting, phaseText, invalidate, addNode, promptsFor, setPrompts, beginReview, sumRange
};
