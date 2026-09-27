/*
 * First run and "Start a new preparation": the welcome screen and the setup wizard.
 * The wizard keeps a draft in this browser, so a reload never loses what was typed. Nothing is written to the
 * preparation until "Create my preparation"; that commit builds the exam, subjects, optional topics, lectures,
 * study time and planner settings in one go, then saves the roadmap baseline and today's plan.
 */
import {
  $, esc, clone, plural, uid, sum, PALETTE, DEFAULT_SETTINGS, Store, FS, ui, core, derive, freshCore, toast, go, renderMain,
  askConfirm, chip, opt, rebaseline, ensurePlan, setSaveStatus, keyToDate
} from './ui.js';
import { examCountdown, isDateKey, parseWindows, calendarToday } from '../lib/dates';
import { generateLectures, syncAutoConcepts } from '../lib/lectures';
import { parseSyllabusOutline, applyImport } from '../lib/syllabus-import';
import { buildPhases, phaseOn, capacity, estimateWork, assessFeasibility, fmtH, effortComparison } from '../lib/roadmap';
import { defaultPrep, normAvailability } from '../lib/workspace';

const DRAFT_KEY = 'prepos:wizard-draft';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LV = { 1: 'Low', 2: 'Medium', 3: 'High' };
/** Formats a date key (YYYY-MM-DD) in local time; never pass keys to Date() directly (it reads them as UTC). */
const fmtK = k => keyToDate(k).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function blankDraft(newPrep) {
  return { step: 'exam', newPrep: !!newPrep, exam: { name: '', desc: '', date: '', time: '', location: '', startDate: calendarToday() },
    count: '', subjects: [], detailed: false, mode: 'self', lec: {},
    avail: { weekday: 120, weekend: 180, weekendDays: [0, 6], rest: [], wWin: '', eWin: '', sessions: 0, minSession: 20, unavailable: [] },
    spd: { weekday: 2, weekend: 3 }, maxSwitches: 0, effort: 'normal', extra: 0, adjust: {}, saveFile: true, errors: {} };
}
function draft() {
  if (ui.wiz) return ui.wiz;
  try { const s = localStorage.getItem(DRAFT_KEY); if (s) { ui.wiz = Object.assign(blankDraft(), JSON.parse(s)); ui.wiz.errors = {}; return ui.wiz; } } catch (e) { /* ignore */ }
  return (ui.wiz = blankDraft());
}
let saveT = null;
function keep() { clearTimeout(saveT); saveT = setTimeout(() => { try { const w = Object.assign({}, ui.wiz, { errors: {} }); localStorage.setItem(DRAFT_KEY, JSON.stringify(w)); } catch (e) { /* ignore */ } }, 300); }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } ui.wiz = null; }
function newSubject(i) { return { key: uid('w'), name: '', imp: 2, diff: 2, priority: 2, est: '', color: PALETTE[i % PALETTE.length], desc: '', target: '', prereq: [], outline: '', open: false }; }
function steps(w) { return ['exam', 'subjects', 'mode'].concat(w.mode === 'lectures' ? ['lectures'] : []).concat(['time', 'perday', 'review']); }
const STEP_NAME = { exam: 'Exam', subjects: 'Subjects', mode: 'How you prepare', lectures: 'Lectures', time: 'Study time', perday: 'Subjects per day', review: 'Review' };

/* ------------------------------------------------------------------ welcome */

export function viewWelcome() {
  const supported = !!(FS && FS.status().supported);
  return `<div class="welcome">
    <div class="welcome-intro"><h1>Plan your preparation, day by day</h1>
      <p>Tell Logbook what you are preparing for and how much time you have. It builds a roadmap to your exam date, checks whether the syllabus fits, and turns it into a plan for each day: lectures, self-study, recall, practice, revision and mistakes.</p></div>
    <div class="welcome-grid">
      <button class="opt-card primary" data-a="welcome-new"><span class="opt-title">Start a new preparation</span><span class="opt-desc">Answer a few questions about your exam, subjects and study time. Takes about five minutes.</span></button>
      <button class="opt-card" data-a="welcome-open"${supported ? '' : ' data-fallback="1"'}><span class="opt-title">Link an existing progress file</span><span class="opt-desc">Continue from your progress .json, for example in the progress folder of your repository${supported ? '. Changes are saved back to it.' : '. This browser cannot save back to the file, so you will download updated copies.'}</span></button>
      <label class="opt-card" style="cursor:pointer"><span class="opt-title">Import older Logbook data</span><span class="opt-desc">A full backup, or the separate data files from the GitHub data repository (select all of them).</span><input type="file" class="sr" accept=".json,application/json" multiple data-c="import"></label>
    </div>
    <p class="tiny muted welcome-privacy">Your progress is saved to a JSON file you choose on this computer${supported ? '' : ' (in this browser, download copies to keep a file)'}, with a copy in this browser for offline use. Keep the file in your repository and push it with git whenever you like; no token is needed. Nothing is sent anywhere unless you turn on account sync or the optional AI features.</p>
  </div>`;
}

/* ------------------------------------------------------------------ wizard */

export function viewWizard() {
  const w = draft(), st = steps(w); if (!st.includes(w.step)) w.step = st[0];
  const i = st.indexOf(w.step);
  const body = { exam: stepExam, subjects: stepSubjects, mode: stepMode, lectures: stepLectures, time: stepTime, perday: stepPerDay, review: stepReview }[w.step](w);
  return `<div class="wiz">
    <div class="wiz-head"><div><div class="small muted">${w.newPrep ? 'New preparation' : 'Set up your preparation'}</div><h1>${esc(STEP_NAME[w.step])}</h1></div>
      <button class="btn sm" data-a="wiz-cancel">${w.newPrep ? 'Cancel' : 'Back to start'}</button></div>
    <ol class="wiz-steps" aria-label="Setup steps">${st.map((k, n) => `<li class="${n < i ? 'done' : n === i ? 'on' : ''}"><button data-a="wiz-go" data-v="${k}"${n > i ? ' disabled' : ''}>${n + 1}. ${esc(STEP_NAME[k])}</button></li>`).join('')}</ol>
    <div class="wiz-body">${body}</div>
    <div class="wiz-foot">${i > 0 ? '<button class="btn" data-a="wiz-back">Back</button>' : '<span></span>'}
      ${w.step === 'review' ? `<button class="btn primary" data-a="wiz-finish">Create my preparation</button>` : `<button class="btn primary" data-a="wiz-next">Continue</button>`}</div>
  </div>`;
}
const err = (w, k) => w.errors[k] ? `<div class="field-err" role="alert">${esc(w.errors[k])}</div>` : '';
function stepExam(w) {
  const e = w.exam, cd = examCountdown(calendarToday(), e.date);
  const ph = e.date && isDateKey(e.date) && cd.days > 0 ? phaseOn(buildPhases(e.startDate && e.startDate <= calendarToday() ? e.startDate : calendarToday(), e.date), calendarToday()) : null;
  const live = cd.status === 'none' ? '<p class="small muted">Add the exam date to see how much time you have.</p>'
    : cd.status === 'past' ? `<div class="note red">That date has passed. Check the year.</div>`
    : `<div class="wiz-count"><div><span class="num big">${cd.days}</span><span class="small muted"> days</span></div><div><span class="num">${cd.weeks}</span><span class="small muted"> weeks${cd.weekDays ? ' ' + cd.weekDays + ' d' : ''}</span></div><div><span class="num">${cd.months}</span><span class="small muted"> months${cd.monthDays ? ' ' + cd.monthDays + ' d' : ''}</span></div>
      <div class="small">${esc(cd.label)}${ph ? `. The roadmap would start in the <strong>${esc(ph.name.toLowerCase())}</strong> phase.` : ''}</div></div>`;
  return `<div class="stack">
    <label class="f big-q">Which exam are you preparing for?<input type="text" data-c="wiz" data-k="exam.name" value="${esc(e.name)}" placeholder="For example: a university semester exam, a certification, an entrance exam" autocomplete="off"></label>${err(w, 'name')}
    <label class="f">Short description (optional)<input type="text" data-c="wiz" data-k="exam.desc" value="${esc(e.desc)}" placeholder="Paper, level or anything that helps you"></label>
    <div class="grid3"><label class="f">Exam date<input type="date" data-c="wiz" data-k="exam.date" value="${esc(e.date)}" min="${calendarToday()}"></label>
      <label class="f">Time (optional)<input type="time" data-c="wiz" data-k="exam.time" value="${esc(e.time)}"></label>
      <label class="f">Preparation starts<input type="date" data-c="wiz" data-k="exam.startDate" value="${esc(e.startDate)}"></label></div>${err(w, 'date')}
    <label class="f">Location or centre (optional)<input type="text" data-c="wiz" data-k="exam.location" value="${esc(e.location)}"></label>
    <div class="panel tight" id="wiz-live">${live}</div></div>`;
}
function stepSubjects(w) {
  const rows = w.subjects.map((s, i) => {
    const others = w.subjects.filter(x => x.key !== s.key && x.name.trim());
    return `<div class="wiz-subj" data-key="${s.key}">
      <div class="wiz-subj-main">
        <button class="swatch" style="background:${s.color}" data-a="wiz-color" data-id="${s.key}" aria-label="Change colour" title="Change colour"></button>
        <input type="text" data-c="wiz-s" data-id="${s.key}" data-k="name" value="${esc(s.name)}" placeholder="Subject ${i + 1} name" aria-label="Subject ${i + 1} name">
        <label class="mini">Importance<select data-c="wiz-s" data-id="${s.key}" data-k="imp">${[3, 2, 1].map(v => opt(v, LV[v], s.imp)).join('')}</select></label>
        <label class="mini">Difficulty<select data-c="wiz-s" data-id="${s.key}" data-k="diff">${[[1, 'Easy'], [2, 'Medium'], [3, 'Hard']].map(x => opt(x[0], x[1], s.diff)).join('')}</select></label>
        <label class="mini">Hours (est.)<input type="number" min="0" data-c="wiz-s" data-id="${s.key}" data-k="est" value="${esc(s.est)}" placeholder="auto"></label>
        <div class="wiz-subj-tools"><button class="iconbtn" data-a="wiz-s-move" data-id="${s.key}" data-v="-1" aria-label="Move up"${i ? '' : ' disabled'}>↑</button><button class="iconbtn" data-a="wiz-s-move" data-id="${s.key}" data-v="1" aria-label="Move down"${i < w.subjects.length - 1 ? '' : ' disabled'}>↓</button>
          <button class="iconbtn" data-a="wiz-s-open" data-id="${s.key}" aria-expanded="${s.open || w.detailed}">${s.open || w.detailed ? 'Less' : 'More'}</button><button class="iconbtn" data-a="wiz-s-del" data-id="${s.key}" aria-label="Remove subject">Remove</button></div>
      </div>
      ${s.open || w.detailed ? `<div class="wiz-subj-more">
        <div class="grid3"><label class="f">Priority<select data-c="wiz-s" data-id="${s.key}" data-k="priority">${[[3, 'Do first'], [2, 'Normal'], [1, 'Later']].map(x => opt(x[0], x[1], s.priority)).join('')}</select></label>
          <label class="f">Finish learning by (optional)<input type="date" data-c="wiz-s" data-id="${s.key}" data-k="target" value="${esc(s.target)}"></label>
          <label class="f">Description (optional)<input type="text" data-c="wiz-s" data-id="${s.key}" data-k="desc" value="${esc(s.desc)}"></label></div>
        ${others.length ? `<div><div class="sheet-label">Learn after</div><div class="chips">${others.map(o => chip(esc(o.name), s.prereq.includes(o.key), `data-a="wiz-s-pre" data-id="${s.key}" data-v="${o.key}"`)).join('')}</div></div>` : ''}
        <label class="f">Topics and concepts (optional): one per line, indent concepts under their topic
          <textarea data-c="wiz-s" data-id="${s.key}" data-k="outline" rows="5" placeholder="Mechanics&#10;  Newton's laws&#10;  Work and energy&#10;Thermodynamics&#10;  First law">${esc(s.outline)}</textarea></label>
      </div>` : ''}</div>`;
  }).join('');
  return `<div class="stack">
    <div class="row" style="align-items:flex-end"><label class="f big-q" style="max-width:360px">How many subjects are you preparing?<input type="number" min="1" max="40" data-c="wiz" data-k="count" value="${esc(w.count || (w.subjects.length || ''))}" placeholder="For example 6"></label>
      <button class="btn" data-a="wiz-count">Set</button></div>${err(w, 'subjects')}
    <div class="row"><span class="small muted">Structure</span>${chip('Subjects only', !w.detailed, 'data-a="wiz-detail" data-v="0"')}${chip('Subjects, topics and concepts', w.detailed, 'data-a="wiz-detail" data-v="1"')}</div>
    <p class="tiny muted">A subject name is enough to plan with. Topics and concepts make the estimate and the daily tasks more precise; you can add or import them any time later.</p>
    <div class="wiz-subjs">${rows || '<div class="empty small">Set the number of subjects, or add them one by one.</div>'}</div>
    <div><button class="btn sm" data-a="wiz-s-add">Add a subject</button></div></div>`;
}
function stepMode(w) {
  return `<div class="stack"><p>How will you prepare?</p><div class="welcome-grid two">
    <button class="opt-card${w.mode === 'self' ? ' selected' : ''}" data-a="wiz-mode" data-v="self" aria-pressed="${w.mode === 'self'}"><span class="opt-title">Self study</span><span class="opt-desc">Books, notes and practice. Days are planned from your syllabus: new concepts, recall, practice and revision.</span></button>
    <button class="opt-card${w.mode === 'lectures' ? ' selected' : ''}" data-a="wiz-mode" data-v="lectures" aria-pressed="${w.mode === 'lectures'}"><span class="opt-title">Self study with lectures</span><span class="opt-desc">A lecture course plus your own work. Each lecture becomes watch, self-study and recall, then practice and revision.</span></button>
  </div></div>`;
}
function stepLectures(w) {
  const subs = w.subjects.filter(s => s.name.trim());
  return `<div class="stack"><p>How many lectures does each subject have? They are numbered L01, L02 and so on; you can rename, insert and reorder them later.</p>
    <div class="list">${subs.map(s => { const l = w.lec[s.key] || {}; const n = +l.count || 0;
      return `<div class="li wiz-lec"><span class="dot" style="background:${s.color}"></span><div class="grow"><div class="title">${esc(s.name)}</div>
        <div class="tiny muted">${n ? `L01 to L${String(n).padStart(n >= 100 ? 3 : 2, '0')}` : 'No lectures'}</div></div>
        <label class="mini">Lectures<input type="number" min="0" max="2000" data-c="wiz-l" data-id="${s.key}" data-k="count" value="${esc(l.count || '')}" placeholder="0"></label>
        <label class="mini">Minutes each<input type="number" min="5" max="600" data-c="wiz-l" data-id="${s.key}" data-k="min" value="${esc(l.min || 60)}"></label>
        <details class="wiz-titles"><summary class="small">Titles</summary><label class="f tiny">One per line, in order (optional)<textarea rows="4" data-c="wiz-l" data-id="${s.key}" data-k="titles" placeholder="Introduction to limits&#10;Continuity">${esc(l.titles || '')}</textarea></label></details></div>`; }).join('')}</div>
    ${err(w, 'lectures')}</div>`;
}
function stepTime(w) {
  const a = w.avail, wp = parseWindows(a.wWin), ep = parseWindows(a.eWin);
  const weekMin = sum([0, 1, 2, 3, 4, 5, 6].map(d => a.rest.includes(d) ? 0 : a.weekendDays.includes(d) ? +a.weekend || 0 : +a.weekday || 0));
  return `<div class="stack">
    <div class="grid2"><label class="f big-q">Study minutes on a normal weekday<input type="number" min="0" max="1200" step="5" data-c="wiz" data-k="avail.weekday" value="${esc(a.weekday)}"></label>
      <label class="f big-q">On weekend days<input type="number" min="0" max="1200" step="5" data-c="wiz" data-k="avail.weekend" value="${esc(a.weekend)}"></label></div>
    <p class="small muted">About ${fmtH(weekMin)} a week. Be honest: the roadmap is only as useful as these numbers.</p>${err(w, 'time')}
    <div class="grid2"><div><div class="sheet-label">Weekend days</div><div class="chips">${DOW.map((n, d) => chip(n, a.weekendDays.includes(d), `data-a="wiz-dow" data-k="weekendDays" data-v="${d}"`)).join('')}</div></div>
      <div><div class="sheet-label">Rest days (no study)</div><div class="chips">${DOW.map((n, d) => chip(n, a.rest.includes(d), `data-a="wiz-dow" data-k="rest" data-v="${d}"`)).join('')}</div></div></div>
    <div class="grid2"><label class="f">Weekday study windows (optional)<input type="text" data-c="wiz" data-k="avail.wWin" value="${esc(a.wWin)}" placeholder="06:00-08:00, 18:00-21:00">
        <span class="tiny ${wp.errors.length ? 'bad' : 'muted'}">${wp.errors.length ? 'Could not read: ' + esc(wp.errors.join(', ')) : wp.windows.length ? 'Tasks get times inside these windows.' : 'Without windows, tasks are listed in order without times.'}</span></label>
      <label class="f">Weekend study windows (optional)<input type="text" data-c="wiz" data-k="avail.eWin" value="${esc(a.eWin)}" placeholder="09:00-12:00, 16:00-19:00">
        <span class="tiny ${ep.errors.length ? 'bad' : 'muted'}">${ep.errors.length ? 'Could not read: ' + esc(ep.errors.join(', ')) : '&nbsp;'}</span></label></div>
    <div class="grid3"><label class="f">Study sessions per day (optional)<input type="number" min="0" max="12" data-c="wiz" data-k="avail.sessions" value="${esc(a.sessions || '')}" placeholder="any"></label>
      <label class="f">Shortest useful session (minutes)<input type="number" min="5" max="180" data-c="wiz" data-k="avail.minSession" value="${esc(a.minSession)}"></label>
      <div><div class="sheet-label">Dates you cannot study</div><div class="row"><input type="date" id="wiz-unav" style="width:auto"><button class="btn sm" data-a="wiz-unav-add">Add</button></div>
        <div class="chips" style="margin-top:6px">${a.unavailable.map(k => chip(esc(fmtK(k)) + ' ×', true, `data-a="wiz-unav-del" data-v="${k}"`)).join('')}</div></div></div></div>`;
}
function stepPerDay(w) {
  const n = w.subjects.filter(s => s.name.trim()).length;
  return `<div class="stack"><p>How many different subjects do you want to study in one day? Fewer subjects means deeper sessions; more means more variety. Subjects still rotate across the week so none is left behind.</p>
    <div class="grid3"><label class="f big-q">On weekdays<select data-c="wiz" data-k="spd.weekday">${[0, 1, 2, 3, 4, 5, 6].filter(x => x <= Math.max(1, n) || x === 0).map(x => opt(x, x ? plural(x, 'subject') : 'No limit', w.spd.weekday)).join('')}</select></label>
      <label class="f big-q">On weekends<select data-c="wiz" data-k="spd.weekend">${[0, 1, 2, 3, 4, 5, 6].filter(x => x <= Math.max(1, n) || x === 0).map(x => opt(x, x ? plural(x, 'subject') : 'No limit', w.spd.weekend)).join('')}</select></label>
      <label class="f">Most subject switches in a day<select data-c="wiz" data-k="maxSwitches">${[0, 1, 2, 3, 4, 5].map(x => opt(x, x ? String(x) : 'No limit', w.maxSwitches)).join('')}</select></label></div>
    <p class="tiny muted">Review, cumulative recall and saved questions can mix subjects on any day; that mixing helps memory. The limit applies to new learning, lectures and practice.</p></div>`;
}

/* ------------------------------------------------------------------ feasibility preview (pure, from the draft) */

function draftModel(w) {
  const cal = calendarToday(), e = w.exam, dl = e.date && isDateKey(e.date) ? examCountdown(cal, e.date).days : null;
  const P = Object.assign(defaultPrep(), { mode: w.mode, dropLowImportance: !!w.adjust.drop, practiceScale: w.adjust.practice ? 0.6 : 1 });
  const av = availFromDraft(w);
  const subs = w.subjects.filter(s => s.name.trim());
  const inputs = subs.map(s => {
    const tree = s.outline.trim() ? parseSyllabusOutline(s.name + '\n' + s.outline.split('\n').map(x => '  ' + x).join('\n')) : null;
    const concepts = []; if (tree && tree.subjects[0]) tree.subjects[0].topics.forEach(t => { (t.concepts.length ? t.concepts : [t]).forEach(() => concepts.push({ state: 0, viaLecture: false, imp: s.imp, acc: null, accN: 0, S: null })); t.subtopics.forEach(st => st.concepts.forEach(() => concepts.push({ state: 0, viaLecture: false, imp: s.imp, acc: null, accN: 0, S: null }))); });
    const l = w.mode === 'lectures' ? (w.lec[s.key] || {}) : {}; const ln = +l.count || 0;
    if (ln) concepts.forEach(c => { c.viaLecture = true; });
    // a subject with lectures but no topics gets one concept per lecture when it is created (see syncAutoConcepts)
    if (ln && !concepts.length) for (let i = 0; i < ln; i++) concepts.push({ state: 0, viaLecture: true, imp: s.imp, acc: null, accN: 0, S: null });
    return { id: s.key, name: s.name, imp: s.imp, diff: s.diff, priority: s.priority, estHours: +s.est || null, studiedMin: 0, concepts,
      lectures: Array.from({ length: ln }, () => ({ min: +l.min || 60, watched: false, studied: false, done: false })), questions: [], openMistakes: [] };
  });
  const extra = w.effort === 'extra' ? +w.extra || 0 : 0;
  const cap = dl && dl > 0 ? capacity(cal, e.date, av, { extraPerDay: extra }) : { total: 0, days: 0, studyDays: 0, weekdayStudyDays: 0, weekendStudyDays: 0, restDays: 0, perDay: [] };
  const work = estimateWork(inputs, { daysLeft: dl || 180, prep: P, minPerReview: 1.5 });
  const feas = assessFeasibility({ work, cap, av, daysLeft: dl, subjects: subs.map(s => ({ id: s.key, name: s.name, imp: s.imp, priority: s.priority })) });
  const base = w.effort === 'extra' ? assessFeasibility({ work, cap: capacity(cal, e.date || cal, av, {}), av, daysLeft: dl, subjects: subs.map(s => ({ id: s.key, name: s.name, imp: s.imp, priority: s.priority })) }) : feas;
  return { dl, cap, work, feas, base, phases: dl && dl > 0 ? buildPhases(e.startDate && e.startDate <= cal ? e.startDate : cal, e.date) : [] };
}
function availFromDraft(w) {
  const a = w.avail;
  return normAvailability({ weekday: { minutes: +a.weekday || 0, windows: parseWindows(a.wWin).windows }, weekend: { minutes: +a.weekend || 0, windows: parseWindows(a.eWin).windows },
    weekendDays: a.weekendDays, restDays: a.rest, unavailable: a.unavailable, sessionsPerDay: +a.sessions || 0, minSession: +a.minSession || 20 }, 120);
}
function stepReview(w) {
  const m = draftModel(w), f = m.feas, subs = w.subjects.filter(s => s.name.trim());
  const lec = w.mode === 'lectures' ? sum(subs.map(s => +(w.lec[s.key] || {}).count || 0)) : 0;
  const fitText = f.status === 'short'
    ? `<div class="note red"><strong>This does not fit yet.</strong> Your roadmap needs about ${fmtH(f.requiredMin)}. You have about ${fmtH(f.availableMin)} of study time before the exam, so you are short by about ${fmtH(f.gapMin)}.</div>`
    : f.status === 'tight' ? `<div class="note">It fits, just: about ${fmtH(f.requiredMin)} needed and ${fmtH(f.availableMin)} available. Little room for missed days.</div>`
    : f.status === 'ok' ? `<div class="note green">It fits: about ${fmtH(f.requiredMin)} needed, ${fmtH(f.availableMin)} available, leaving about ${fmtH(f.bufferMin)} of buffer.</div>`
    : `<div class="note">Add an exam date in the first step to check whether the plan fits.</div>`;
  const choices = f.status === 'short' || w.effort === 'extra' || Object.keys(w.adjust).some(k => w.adjust[k]) ? feasibilityChoices(w, m) : '';
  return `<div class="stack">
    <div class="wiz-summary"><div><div class="sheet-label">Exam</div><div class="title">${esc(w.exam.name)}</div><div class="small muted">${w.exam.date ? esc(fmtK(w.exam.date)) + ', ' + esc(examCountdown(calendarToday(), w.exam.date).label.toLowerCase()) : 'No date'}</div></div>
      <div><div class="sheet-label">Subjects</div><div class="title">${subs.length}</div><div class="small muted">${esc(subs.slice(0, 4).map(s => s.name).join(', '))}${subs.length > 4 ? '…' : ''}</div></div>
      <div><div class="sheet-label">Mode</div><div class="title">${w.mode === 'lectures' ? 'With lectures' : 'Self study'}</div><div class="small muted">${lec ? plural(lec, 'lecture') : '&nbsp;'}</div></div>
      <div><div class="sheet-label">Study time</div><div class="title">${fmtH(+w.avail.weekday || 0)} / ${fmtH(+w.avail.weekend || 0)}</div><div class="small muted">weekday / weekend</div></div></div>
    ${m.phases.length ? `<div><div class="sheet-label">Roadmap phases</div><div class="runway-mini">${m.phases.map(p => `<span class="ph ph-${p.key}" style="flex:${Math.max(1, (new Date(p.end) - new Date(p.start)) / 864e5 + 1)}" title="${esc(p.name)}: ${esc(p.start)} to ${esc(p.end)}">${esc(p.name)}</span>`).join('')}</div></div>` : ''}
    ${fitText}${choices}
    <details><summary class="small">How this is estimated</summary><ul class="small muted">${m.work.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}<li>Estimates are planning aids, not predictions. They improve as you log study, lectures and practice.</li></ul></details>
    ${FS && FS.status().fileName ? `<p class="small">Your progress will be saved to <b>${esc(FS.status().fileName)}</b>, the file you linked.</p>`
      : FS && FS.status().supported ? `<label class="check"><input type="checkbox" data-c="wiz" data-k="saveFile" data-t="bool"${w.saveFile ? ' checked' : ''}> Save my progress to a JSON file on this computer, for example in the progress folder of my repository (recommended)</label>`
      : '<p class="tiny muted">This browser cannot save to a file directly. Your preparation stays in this browser; use "Download a copy" in the storage menu to keep a file.</p>'}
  </div>`;
}
function feasibilityChoices(w, m) {
  const f = m.feas, opts = f.options || [], eff = effortComparison(m.base.status === 'short' ? m.base : f);
  const extraOpt = (m.base.options || []).find(o => o.key === 'extra-daily');
  const rows = [];
  if (extraOpt || w.effort === 'extra') rows.push(`<div class="effort-pair">
      <button class="opt-card${w.effort !== 'extra' ? ' selected' : ''}" data-a="wiz-effort" data-v="normal"><span class="opt-title">Normal plan</span><span class="opt-desc">${fmtH(m.base.currentPerStudyDay)} a study day. About ${Math.round(m.base.coverage * 100)}% of the estimated work fits.</span></button>
      <button class="opt-card${w.effort === 'extra' ? ' selected' : ''}" data-a="wiz-effort" data-v="extra" data-n="${Math.min(900, extraOpt ? extraOpt.value : +w.extra || 0)}"><span class="opt-title">Extra effort plan</span><span class="opt-desc">+${extraOpt ? extraOpt.value : w.extra} minutes on each study day (${fmtH(eff.normal.perDay + (extraOpt ? extraOpt.value : +w.extra || 0))}). ${eff.normal.perDay + (extraOpt ? extraOpt.value : +w.extra || 0) > 720 ? 'More than 12 hours a day is not realistic; combine it with the changes below, or accept that not everything fits.' : 'Covers everything if you keep it up.'}</span></button></div>`);
  const pick = [['extra-weekend', 'weekend'], ['more-days', 'restdays'], ['drop-optional', 'drop'], ['reduce-practice', 'practice']];
  const toggles = pick.map(([k, a]) => { const o = opts.find(x => x.key === k) || (m.base.options || []).find(x => x.key === k); if (!o && !w.adjust[a]) return '';
    return chip(esc(o ? o.label : a), !!w.adjust[a], `data-a="wiz-adjust" data-v="${a}"${o && o.value ? ` data-n="${o.value}"` : ''} title="${esc(o ? o.detail : '')}"`); }).join('');
  if (toggles) rows.push(`<div><div class="sheet-label">Or change the plan</div><div class="chips">${toggles}</div></div>`);
  if (f.status === 'short') rows.push(`<label class="check"><input type="checkbox" data-c="wiz" data-k="adjust.accept" data-t="bool"${w.adjust.accept ? ' checked' : ''}> Keep this schedule and accept that not everything fits${f.atRisk.length ? ` (the shortfall falls on ${esc(f.atRisk.map(x => x.name).join(', '))})` : ''}</label>`);
  return `<div class="stack">${rows.join('')}</div>`;
}

/* ------------------------------------------------------------------ validation and commit */

function validate(w, step) {
  const e = {}, cal = calendarToday();
  if (step === 'exam' || step === 'all') {
    if (!w.exam.name.trim()) e.name = 'Name the exam you are preparing for.';
    if (!w.exam.date) e.date = 'Add the exam date. If it is not announced yet, use your best estimate and change it later.';
    else if (!isDateKey(w.exam.date)) e.date = 'That is not a valid date.';
    else if (w.exam.date < cal) e.date = 'The exam date is in the past.';
    else if (w.exam.startDate && isDateKey(w.exam.startDate) && w.exam.startDate > w.exam.date) e.date = 'Preparation cannot start after the exam.';
  }
  if (step === 'subjects' || step === 'all') {
    const named = w.subjects.filter(s => s.name.trim());
    if (!named.length) e.subjects = 'Add at least one subject.';
    const names = named.map(s => s.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) e.subjects = 'Two subjects have the same name.';
  }
  if (step === 'time' || step === 'all') { if (!(+w.avail.weekday > 0) && !(+w.avail.weekend > 0)) e.time = 'Add some study time on weekdays or weekends.'; }
  return e;
}
async function finish() {
  const w = draft();
  w.errors = validate(w, 'all');
  if (Object.keys(w.errors).length) { w.step = w.errors.name || w.errors.date ? 'exam' : w.errors.subjects ? 'subjects' : 'time'; renderMain(); toast('Something needs fixing before the plan can be made.'); return; }
  // Pick the file first, while the click still counts as a user action.
  const old = derive(), hadData = old.subjects.length || old.sessions.length;
  const keepLinked = !hadData && FS && FS.status().fileName;          // a file linked before setup (for example an empty one) is used as is
  let handle = null;
  if (!keepLinked && w.saveFile && FS && FS.status().supported) { try { handle = await FS.pick(w.exam.name); } catch (e) { console.error(e); } }
  if (hadData) { await FS.saveRecovery(); await FS.forget(); }
  const cur = core(), c = freshCore(), now = Date.now();
  c.settings = Object.assign(clone(DEFAULT_SETTINGS), { name: cur.settings.name || '', theme: cur.settings.theme || 'auto', retention: cur.settings.retention || 0.9, dayStartHour: cur.settings.dayStartHour ?? 4 });
  if (!hadData && cur.wsid) c.wsid = cur.wsid;
  const ex = { id: uid('e'), name: w.exam.name.trim(), desc: w.exam.desc.trim() || undefined, date: w.exam.date, time: w.exam.time || undefined, location: w.exam.location.trim() || undefined,
    startDate: isDateKey(w.exam.startDate) ? w.exam.startDate : calendarToday(), archived: false };
  c.exams = [ex]; c.settings.activeExamId = ex.id;
  const subs = w.subjects.filter(s => s.name.trim()), idOf = {};
  subs.forEach(s => { idOf[s.key] = uid('s'); });
  c.nodes = subs.map((s, i) => ({ id: idOf[s.key], kind: 'subject', name: s.name.trim(), order: i, examIds: [ex.id], imp: +s.imp || 2, diff: +s.diff || 2, priority: +s.priority || 2,
    estHours: +s.est > 0 ? +s.est : null, targetDate: isDateKey(s.target) ? s.target : null, prereqSubjects: s.prereq.map(k => idOf[k]).filter(Boolean), color: s.color, desc: s.desc.trim(), share: 0, createdAt: now }));
  for (const s of subs) if (s.outline.trim()) {
    const tree = parseSyllabusOutline(s.name.trim() + '\n' + s.outline.split('\n').map(x => '  ' + x).join('\n'));
    c.nodes = applyImport(tree, c.nodes, { examId: ex.id, palette: PALETTE, id: uid }).nodes;
  }
  c.lectures = [];
  if (w.mode === 'lectures') for (const s of subs) {
    const l = w.lec[s.key] || {}, n = Math.max(0, Math.min(2000, Math.floor(+l.count || 0))); if (!n) continue;
    const titles = String(l.titles || '').split('\n').map(x => x.trim());
    const gen = generateLectures(idOf[s.key], n, { min: +l.min || 60, id: uid }).map((x, i) => titles[i] ? Object.assign(x, { name: titles[i] }) : x);
    c.lectures = c.lectures.concat(gen);
    const r = syncAutoConcepts(c.nodes, c.lectures, idOf[s.key], { id: uid }); c.nodes = r.nodes; c.lectures = r.lectures;
  }
  c.prep = Object.assign(defaultPrep(), { mode: w.mode, subjectsPerDay: { weekday: +w.spd.weekday || 0, weekend: +w.spd.weekend || 0 }, maxSwitches: +w.maxSwitches || 0,
    effort: w.effort === 'extra' ? 'extra' : 'normal', extraMinPerDay: w.effort === 'extra' ? +w.extra || 0 : 0, dropLowImportance: !!w.adjust.drop, practiceScale: w.adjust.practice ? 0.6 : 1,
    acceptIncomplete: !!w.adjust.accept, setupDone: true });
  const av = availFromDraft(w);
  if (w.adjust.weekend && w.adjust.weekendN) av.weekend.minutes += +w.adjust.weekendN;
  if (w.adjust.restdays) av.restDays = [];
  c.availability = av;
  c.settings.dailyMin = av.weekday.minutes || av.weekend.minutes; c.settings.avail = av.weekday.minutes || null;
  c.settings.weeklyMin = sum([0, 1, 2, 3, 4, 5, 6].map(d => av.restDays.includes(d) ? 0 : av.weekendDays.includes(d) ? av.weekend.minutes : av.weekday.minutes));
  c.createdAt = now; c.updatedAt = now;
  Store.setDocs({ core: c }, 'replace');
  rebaseline(); ensurePlan(true);
  clearDraft();
  let saved = false;
  if (handle) { try { saved = await FS.createNew(ex.name, handle); } catch (e) { console.error(e); } }
  else FS.markDirty();
  setSaveStatus();
  go('today');
  toast(saved ? 'Your preparation is ready and saved to ' + handle.name + '.' : keepLinked ? 'Your preparation is ready and saved to ' + FS.status().fileName + '.'
    : FS.status().supported ? 'Your preparation is ready. Create or link a progress file in Settings, Store progress, to save it on your computer.' : 'Your preparation is ready.');
}

/* ------------------------------------------------------------------ actions */

function setPath(o, path, v) { const k = path.split('.'); let x = o; for (let i = 0; i < k.length - 1; i++) x = x[k[i]]; x[k[k.length - 1]] = v; }
function subj(key) { return draft().subjects.find(s => s.key === key); }
function refresh(focusSel) {
  const a = document.activeElement, sel = focusSel || (a && a.dataset && a.dataset.k ? `[data-k="${a.dataset.k}"]${a.dataset.id ? `[data-id="${a.dataset.id}"]` : ''}` : null);
  const pos = a && typeof a.selectionStart === 'number' ? a.selectionStart : null;
  renderMain();
  if (sel) { const el = document.querySelector('#main ' + sel); if (el) { el.focus({ preventScroll: true }); if (pos != null && el.setSelectionRange && el.type !== 'number' && el.type !== 'date') try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } }
}
export const ACT = {
  'welcome-new': () => { ui.wiz = draft(); if (ui.wiz.newPrep) ui.wiz.newPrep = false; go('setup'); },
  'wiz-cancel': () => { const w = draft(); if (w.newPrep) { clearDraft(); go('today'); } else { go('welcome'); } },
  'wiz-go': el => { draft().step = el.dataset.v; keep(); renderMain(); window.scrollTo(0, 0); },
  'wiz-back': () => { const w = draft(), st = steps(w); w.step = st[Math.max(0, st.indexOf(w.step) - 1)]; w.errors = {}; keep(); renderMain(); window.scrollTo(0, 0); },
  'wiz-next': () => {
    const w = draft(), st = steps(w);
    if (w.step === 'subjects' && !w.subjects.length && +w.count > 0) ACT['wiz-count']();
    w.errors = validate(w, w.step);
    if (Object.keys(w.errors).length) { renderMain(); const e = document.querySelector('.field-err'); if (e) e.scrollIntoView({ block: 'center' }); return; }
    w.step = st[Math.min(st.length - 1, st.indexOf(w.step) + 1)]; keep(); renderMain(); window.scrollTo(0, 0);
  },
  'wiz-finish': () => { finish().catch(e => { console.error(e); toast('Could not create the preparation: ' + e.message); }); },
  'wiz-count': () => {
    const w = draft(), n = Math.max(0, Math.min(40, Math.floor(+w.count || 0)));
    if (!n) { toast('Enter how many subjects.'); return; }
    const named = w.subjects.slice(n).filter(s => s.name.trim());
    const apply = () => { while (w.subjects.length < n) w.subjects.push(newSubject(w.subjects.length)); w.subjects = w.subjects.slice(0, n); w.errors = {}; keep(); renderMain(); };
    if (named.length) askConfirm({ title: 'Remove subjects?', text: `${named.map(s => esc(s.name)).join(', ')} will be removed from the list.`, yes: 'Remove', danger: true, fn: apply });
    else apply();
  },
  'wiz-detail': el => { draft().detailed = el.dataset.v === '1'; keep(); renderMain(); },
  'wiz-s-add': () => { const w = draft(); w.subjects.push(newSubject(w.subjects.length)); w.count = w.subjects.length; keep(); refresh(`[data-id="${w.subjects[w.subjects.length - 1].key}"][data-k="name"]`); },
  'wiz-s-del': el => { const w = draft(); w.subjects = w.subjects.filter(s => s.key !== el.dataset.id); w.subjects.forEach(s => { s.prereq = s.prereq.filter(k => k !== el.dataset.id); }); w.count = w.subjects.length; keep(); renderMain(); },
  'wiz-s-move': el => { const w = draft(), i = w.subjects.findIndex(s => s.key === el.dataset.id), j = i + (+el.dataset.v); if (i < 0 || j < 0 || j >= w.subjects.length) return; const [x] = w.subjects.splice(i, 1); w.subjects.splice(j, 0, x); keep(); renderMain(); },
  'wiz-s-open': el => { const s = subj(el.dataset.id); if (s) { s.open = !s.open; keep(); renderMain(); } },
  'wiz-s-pre': el => { const s = subj(el.dataset.id), v = el.dataset.v; if (!s) return; s.prereq = s.prereq.includes(v) ? s.prereq.filter(x => x !== v) : s.prereq.concat(v); keep(); renderMain(); },
  'wiz-color': el => { const s = subj(el.dataset.id); if (!s) return; s.color = PALETTE[(PALETTE.indexOf(s.color) + 1) % PALETTE.length]; keep(); renderMain(); },
  'wiz-mode': el => { draft().mode = el.dataset.v; keep(); renderMain(); },
  'wiz-dow': el => { const a = draft().avail, k = el.dataset.k, d = +el.dataset.v; a[k] = a[k].includes(d) ? a[k].filter(x => x !== d) : a[k].concat(d).sort(); keep(); renderMain(); },
  'wiz-unav-add': () => { const v = ($('#wiz-unav') || {}).value; if (!isDateKey(v)) { toast('Pick a date first.'); return; } const a = draft().avail; if (!a.unavailable.includes(v)) a.unavailable = a.unavailable.concat(v).sort(); keep(); renderMain(); },
  'wiz-unav-del': el => { const a = draft().avail; a.unavailable = a.unavailable.filter(k => k !== el.dataset.v); keep(); renderMain(); },
  'wiz-effort': el => { const w = draft(); w.effort = el.dataset.v; if (el.dataset.n) w.extra = +el.dataset.n; keep(); renderMain(); },
  'wiz-adjust': el => { const w = draft(), k = el.dataset.v; w.adjust[k] = !w.adjust[k]; if (k === 'weekend') w.adjust.weekendN = +el.dataset.n || 0; keep(); renderMain(); }
};
export const CHG = {
  wiz: (el, e) => {
    const w = draft(), k = el.dataset.k;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    setPath(w, k, v); keep();
    // live values re-render on change (not on every keystroke) except the countdown, which updates as you type the date
    if (k === 'exam.date' || k === 'exam.startDate') { if (e.type === 'change' || e.type === 'input') { const box = $('#wiz-live'); if (box) { const tmp = document.createElement('div'); tmp.innerHTML = stepExam(w); const n = tmp.querySelector('#wiz-live'); if (n) box.innerHTML = n.innerHTML; } } }
    else if (e.type === 'change' && (k.startsWith('avail.') || k.startsWith('spd.') || k === 'maxSwitches' || k.startsWith('adjust.') || k === 'saveFile')) refresh();
  },
  'wiz-s': (el, e) => { const s = subj(el.dataset.id); if (!s) return; s[el.dataset.k] = el.value; keep(); if (e.type === 'change' && el.tagName === 'SELECT') refresh(); },
  'wiz-l': (el, e) => { const w = draft(), k = el.dataset.id; const l = w.lec[k] || (w.lec[k] = { count: '', min: 60, titles: '' }); l[el.dataset.k] = el.value; keep(); if (e.type === 'change' && el.dataset.k === 'count') refresh(); }
};
/** Entry point from Settings: start a new preparation (the current one stays in its file). */
export function startNewPreparation() { ui.wiz = blankDraft(true); keep(); go('setup'); }
