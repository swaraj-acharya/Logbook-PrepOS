/*
 * Today (the dashboard), the roadmap and plan views, the weekly review, preparation settings and the storage controls.
 *
 * Everything here reads from ui.js (live data and the planning adapters) and the pure modules in lib/. The day plan
 * is edited in place: completing, skipping, moving, resizing, locking or adding a task marks it as yours, and a
 * regeneration keeps it. Estimates (forecast, workload, feasibility) are always labelled as estimates.
 */
import {
  $, esc, plural, pct, uid, sum, addDays, daysBetween, dayKey, dayStart, keyToDate, fmtDur, fmtDayLong, DAY, KIND_NAME, PALETTE,
  CFG, Store, FS, ui, N, core, derive, model, activeExam, examSubjects, conceptsUnder, subjName, subjColor, sesRow, todayLearning, planBlockSub,
  studiedSec, availOn, windowsOn, missedInfo, ensurePlan, projectWeek, rebaseline, blockDone, nowMinOfDay, planCtx, misDue, riskList,
  toast, go, render, renderMain, renderModal, closeModal, askConfirm, saveStatusInfo, setSaveStatus, saveFile, chip, opt, greeting, invalidate
} from './ui.js';
import { examCountdown, isDateKey, parseWindows, clockToMin, minToClock, isClock, weekdayOf } from '../lib/dates';
import { fmtH, buildWeeklyReview, phaseOn } from '../lib/roadmap';
import { recoveryPlan, slotTasks } from '../lib/dayplan';
import { readText, safeFileName } from '../lib/storage/local-file';
import { docsFromFiles, docsToWorkspace, workspaceSummary, normAvailability } from '../lib/workspace';
import { parseSyllabus, previewImport, applyImport } from '../lib/syllabus-import';
import { lectureStats } from '../lib/lectures';
import { practiceSignal, questionStats } from '../lib/practice';
import { questionsDueCount, resourcesHTML } from './study-ui.js';
import { startNewPreparation } from './setup-ui.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtK = (k, o) => keyToDate(k).toLocaleDateString('en-IN', o || { day: 'numeric', month: 'short' });
const fmtKY = k => fmtK(k, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtKW = k => fmtK(k, { weekday: 'short', day: 'numeric', month: 'short' });
const toneDot = (tone, label) => `<span class="sdot ${tone}" aria-hidden="true"></span>${label ? `<span class="sr">${esc(label)}</span>` : ''}`;
const ONE_SUBJECT_KINDS = new Set(['new', 'practice', 'lecture', 'selfstudy', 'recall']);

/* ================================================================== STORAGE */

/** A banner above every page when saving needs the user (never for the normal saved or saving states). */
export function storageBanner(info) {
  const f = info.file, st = f.state;
  if (ui.view === 'setup' || ui.view === 'welcome') return '';
  const d = derive();
  const hasData = d.subjects.length || d.sessions.length;
  const btn = (a, label, primary) => `<button class="btn sm${primary ? ' primary' : ''}" data-a="${a}">${label}</button>`;
  if (st === 'permission') return `<div class="sbanner warn" role="status">${toneDot('warn')}<div class="grow"><b>Allow saving to ${esc(f.fileName || 'your progress file')}.</b> The browser asks again after a restart. Your changes are safe in this browser meanwhile.</div>${btn('fs-reconnect', 'Reconnect file', true)}</div>`;
  if (st === 'unavailable') return `<div class="sbanner bad" role="alert">${toneDot('bad')}<div class="grow"><b>${esc(f.fileName || 'The progress file')} is not available.</b> It may have been moved, renamed or deleted (a git checkout can do this). Your changes are safe in this browser.</div>${btn('fs-open', 'Link the file again', true)}${btn('fs-create', 'Create a new file')}</div>`;
  if (st === 'blocked') return `<div class="sbanner bad" role="alert">${toneDot('bad')}<div class="grow"><b>Not saving to ${esc(f.fileName || 'the file')}.</b> ${esc(f.message || 'It could not be read, so it was not overwritten.')}</div>${btn('fs-create', 'Create a new file', true)}${btn('fs-open', 'Link another file')}</div>`;
  if (st === 'failed') return `<div class="sbanner bad" role="alert">${toneDot('bad')}<div class="grow"><b>Save failed.</b> ${esc(f.message || '')} It will retry by itself.</div>${btn('fs-save', 'Try again', true)}</div>`;
  if (st === 'nofile' && hasData && FS && FS.status().supported && ui.bannerOff !== d.today && Store.mode !== 'account')
    return `<div class="sbanner" role="status">${toneDot('warn')}<div class="grow"><b>Your progress is not saved to a file yet.</b> It is only in this browser. Create a progress file or link an existing one, for example in the progress folder of your repository.</div>${btn('fs-create', 'Create a progress file', true)}${btn('fs-open', 'Link an existing file')}<button class="iconbtn" data-a="banner-off" aria-label="Hide until tomorrow">Later</button></div>`;
  return '';
}
function lastSavedText(f) {
  if (!f.lastSavedAt) return '';
  const mins = Math.round((Date.now() - f.lastSavedAt) / 60000);
  return mins < 1 ? 'just now' : mins < 60 ? plural(mins, 'minute') + ' ago' : new Date(f.lastSavedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
/** The storage controls ("Store progress"), shared by the storage dialog and Settings. */
function storagePanelHTML() {
  const info = saveStatusInfo(), f = info.file, sup = !!(FS && FS.status().supported);
  const saved = lastSavedText(f);
  const linked = f.fileName ? `<div class="linked">${toneDot(info.tone)}<div class="grow"><div class="sheet-label" style="margin:0">Progress file</div><div class="title">${esc(f.fileName)}</div>
      <div class="small muted">${esc(info.text)}${saved ? '. Last written ' + esc(saved) : ''}. Every change is written to this file a moment after you make it.</div></div>
      <div class="row">${f.state === 'permission' ? '<button class="btn primary" data-a="fs-reconnect">Reconnect file</button>' : '<button class="btn" data-a="fs-save">Save now</button>'}</div></div>` : '';
  const choose = sup ? `<div class="welcome-grid two">
      <button class="opt-card${f.fileName ? '' : ' primary'}" data-a="fs-create"><span class="opt-title">${f.fileName ? 'Create a new progress file instead' : 'Create a new progress file'}</span><span class="opt-desc">Choose a folder (for example the progress folder of your repository) and a name. Your whole preparation is written there as JSON, and kept up to date.</span></button>
      <button class="opt-card" data-a="fs-open"><span class="opt-title">${f.fileName ? 'Link a different progress file' : 'Link an existing progress file'}</span><span class="opt-desc">Pick a progress .json you already have, even an empty one. The app loads it (or fills it, if empty) and keeps writing to it.</span></button></div>`
    : `<div class="note small">This browser cannot write to files directly (Chrome, Edge and other Chromium browsers can). Your progress stays in this browser; use Download a copy to put it in your repository folder, and Import to load it again.</div>`;
  return `<div class="stack">
    ${info.detail ? `<div class="note${info.tone === 'bad' ? ' red' : ''} small">${esc(info.detail)}</div>` : ''}
    ${linked || `<div class="row"><span class="save-status static">${toneDot(info.tone)}<span>${esc(info.text)}</span></span></div>`}
    ${choose}
    <div class="row"><button class="btn sm" data-a="fs-export">Download a copy</button><label class="btn sm">Import older data or a backup<input type="file" class="sr" accept=".json,application/json" multiple data-c="import"></label>
      ${f.fileName ? '<button class="btn sm ghost" data-a="fs-forget">Stop using this file</button>' : ''}</div>
    <details${f.fileName ? '' : ' open'}><summary>Keep your progress on GitHub with git (no token needed)</summary><ol class="small steps-list">
      <li>Create or link the progress file inside the <code>progress</code> folder of your local copy of the repository.</li>
      <li>Study as usual. Tasks, sessions, recall, questions, lectures and mistakes are written to the file as you go, with a readable record for each day under <code>days</code>.</li>
      <li>At the end of the day, in a terminal in the repository folder, run <code>npm run progress:push</code>. It commits each day separately, dated that day, then pushes with your own git login. If you forget a day, the next push still puts each day on its own date.</li>
      <li>On another computer, run <code>git pull</code> first, then link the same file. If the file changes on disk while the app is open, both versions are merged.</li></ol></details>
    ${CFG.server ? `<div class="small"><div class="sheet-label">Account sync</div>${esc(info.server || 'Connecting…')}</div>` : ''}
    <p class="tiny muted">The file is the main copy of your progress. The browser keeps a copy only for offline use and recovery. Web pages are not told which folder a file is in, so only its name is shown. Nothing is uploaded unless you use account sync or the optional AI features.</p>
  </div>`;
}
export function settingsDataHTML() {
  return `<section class="block" id="data" style="margin-top:0"><h2 style="margin-bottom:10px">Store progress</h2><div class="panel stack">${storagePanelHTML()}</div></section>`;
}
/** Less frequent data actions, at the bottom of Settings. */
export function settingsMoreDataHTML() {
  return `<section class="block"><h2 style="margin-bottom:10px">More data options</h2><div class="panel stack">
    <div class="row"><button class="btn" data-a="export-csv">Export sessions as CSV</button><button class="btn" data-a="prep-new">Start a new preparation</button><button class="btn danger" data-a="reset-all">Erase everything in this browser</button></div>
    <p class="tiny muted">Starting a new preparation keeps the current one in its file; link that file again any time to switch back. Erasing unlinks the progress file first and never deletes it.</p></div></section>`;
}
function storageModal() {
  return { wide: true, html: `<div class="mhead"><h2>Store progress</h2><button class="x" data-a="close" aria-label="Close">×</button></div>${storagePanelHTML()}` };
}
function openConfirmModal() {
  const M = ui.modal, r = M.r;
  if (r.empty) return { html: `<div class="mhead"><h2>Link ${esc(r.name)}?</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
    <p>This file is empty. Your current progress will be written into it, and every change after that too.</p>
    <div class="actions"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="open-go">Link and save</button></div>` };
  const s = workspaceSummary(r.ws), same = r.ws.workspaceId === core().wsid;
  const d = derive(), hasData = d.subjects.length || d.sessions.length;
  const src = { v2: 'Progress file', 'v1-backup': 'Older Logbook backup (will be converted)', 'v1-docs': 'Older Logbook data (will be converted)', 'v1-core': 'Older Logbook data (will be converted)', 'data-files': 'Older Logbook data files (will be converted)' }[r.source] || r.source;
  const what = same ? 'This is the same preparation as the one in this browser. The two are merged: nothing is deleted, and the newer version of each item wins.'
    : hasData ? 'This is a different preparation. It replaces what is open now. The current one stays in its own file, and a recovery copy is kept in this browser.'
    : 'It becomes your open preparation.';
  return { html: `<div class="mhead"><h2>Open ${esc(r.name || 'this file')}?</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
    <div class="wiz-summary"><div><div class="sheet-label">Exam</div><div class="title">${esc(s.exam || 'Not set')}</div><div class="small muted">${s.examDate ? esc(fmtKY(s.examDate)) : '&nbsp;'}</div></div>
      <div><div class="sheet-label">Syllabus</div><div class="title">${plural(s.subjects, 'subject')}</div><div class="small muted">${plural(s.concepts, 'concept')}</div></div>
      <div><div class="sheet-label">Logged</div><div class="title">${plural(s.sessions, 'session')}</div><div class="small muted">${plural(s.lectures, 'lecture')}, ${plural(s.questions, 'question')}</div></div></div>
    <p class="small"><b>${esc(src)}.</b> ${what}</p>
    ${r.warnings && r.warnings.length ? `<details><summary>${plural(r.warnings.length, 'note')} about this file</summary><ul class="small muted">${r.warnings.slice(0, 20).map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    ${!r.handle ? '<p class="tiny muted">Opened from an upload, so changes are not written back to that file. Create or link a progress file afterwards to keep one up to date.</p>' : ''}
    <div class="actions"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="open-go">${same ? 'Merge and open' : 'Open'}</button></div>` };
}
/** Any preparation file, old full backup, or the separate data files of the old storage (select several). */
export async function importFiles(list) {
  const files = [...(list || [])]; if (!files.length) return;
  let texts;
  try { texts = await Promise.all(files.map(async f => ({ name: f.name, text: await f.text() }))); }
  catch (e) { toast('Could not read the file: ' + (e && e.message)); return; }
  let r = null, err = null;
  if (texts.length === 1) { try { r = readText(texts[0].text); } catch (e) { err = e; } }
  if (!r) {
    const x = docsFromFiles(texts);
    if (!Object.keys(x.docs).length) { toast(err ? err.message : 'Those files are not Logbook data.'); return; }
    const ws = docsToWorkspace(x.docs);
    if (!x.docs.core) ws.workspaceId = core().wsid;          // only activity files: add them to the open preparation
    r = { ws, docs: x.docs, warnings: x.skipped.map(n => 'Skipped ' + n + ' (not a Logbook data file).'), source: 'data-files', text: '' };
  }
  ui.modal = { type: 'open-confirm', r: Object.assign(r, { handle: null, name: texts.length === 1 ? texts[0].name : plural(texts.length, 'file') }) };
  renderModal();
}
function pickFallback() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.multiple = true;
  i.onchange = () => { importFiles(i.files); }; i.click();
}
function openFile() {
  if (!FS || !FS.status().supported) { pickFallback(); return; }
  FS.pickAndRead().then(r => { if (r) { ui.modal = { type: 'open-confirm', r }; renderModal(); } })
    .catch(e => { console.error(e); toast(e && e.message ? e.message : 'That file could not be opened.'); });
}
export function exportCopy() {
  const ex = activeExam();
  saveFile(safeFileName(ex ? ex.name : 'my-preparation'), FS ? FS.exportText() : '{}');
}
function createFile() {
  const ex = activeExam();
  FS.createNew(ex ? ex.name : 'my-preparation').then(ok => { setSaveStatus(); if (ok) toast('Saved to ' + FS.status().fileName + '. Changes will be saved to it automatically.'); renderMain(); })
    .catch(e => { console.error(e); toast('Could not create the file: ' + (e && e.message)); setSaveStatus(); });
}

/* ================================================================== TODAY (dashboard) */

function forecastInfo(m) {
  const f = m.forecast, fe = m.feas, ex = m.ex;
  if (!ex) return { tone: 'warn', text: 'No active exam. Choose one in Settings.' };
  if (!ex.date || !isDateKey(ex.date)) return { tone: 'warn', text: 'Add the exam date to see whether you are on track.' };
  if (m.dl != null && m.dl <= 0) return { tone: 'ok', text: m.dl === 0 ? 'Exam day. Trust your preparation.' : 'The exam date has passed. Update it in Settings for a new roadmap.' };
  if (!f) return { tone: 'warn', text: 'Not enough information for a forecast yet.' };
  const extra = f.extraMinPerDay > 480 ? ' Extra daily time alone cannot close this gap; see the options on the roadmap.' : f.extraMinPerDay > 0 ? ` Needs about +${f.extraMinPerDay} min a day.` : '';
  if (f.status === 'done') return { tone: 'ok', text: 'All new learning is covered. The rest is practice and revision.' };
  if (f.status === 'ahead') return { tone: 'ok', text: `Ahead of the roadmap. New learning should finish around ${fmtK(f.completion)}, before the target of ${fmtK(f.target)}.` };
  if (f.status === 'on-track') return { tone: 'ok', text: `On track. New learning should finish around ${fmtK(f.completion)}${f.target ? ` (target ${fmtK(f.target)})` : ''}.` };
  if (f.status === 'behind') return { tone: fe.status === 'short' && !core().prep.acceptIncomplete ? 'bad' : 'warn',
    text: f.completion ? `Behind by about ${plural(f.daysDiff, 'day')}: new learning would finish ${fmtK(f.completion)} instead of ${fmtK(f.target)}.${extra}` : `At the planned pace new learning does not finish before the exam.${extra}` };
  return { tone: 'warn', text: 'Forecast unavailable.' };
}
/** The signature element: preparation start to exam day, phases, today, the coverage target and the forecast. */
function runwayHTML(m, compact) {
  const ex = m.ex; if (!ex || !m.phases.length) return '';
  const start = m.phases[0].start, end = ex.date, T = Math.max(1, daysBetween(start, end));
  const pos = k => Math.max(0, Math.min(100, daysBetween(start, k) / T * 100));
  const today = pos(m.cal), f = m.forecast;
  const segs = m.phases.map(p => `<span class="rw-ph ph-${p.key}${m.phase && p.key === m.phase.key ? ' on' : ''}" style="flex:${daysBetween(p.start, p.end) + 1}" title="${esc(p.name)}: ${esc(fmtK(p.start))} to ${esc(fmtK(p.end))}"><span>${esc(p.name)}</span></span>`).join('');
  const marks = [];
  if (f && f.target) marks.push(`<i class="rw-mark target" style="left:${pos(f.target)}%" title="Syllabus covered by ${esc(fmtK(f.target))} (roadmap target)"></i>`);
  if (f && f.completion && f.status !== 'done' && f.completion <= end) marks.push(`<i class="rw-mark fc ${f.status}" style="left:${pos(f.completion)}%" title="Estimated finish of new learning: ${esc(fmtK(f.completion))}"></i>`);
  return `<div class="runway${compact ? ' compact' : ''}" role="img" aria-label="Roadmap from ${esc(fmtKY(start))} to the exam on ${esc(fmtKY(end))}. Today is ${Math.round(today)}% of the way.">
    <div class="rw-track">${segs}<i class="rw-past" style="width:${today}%"></i>${marks.join('')}<i class="rw-today" style="left:${today}%"></i></div>
    <div class="rw-ends"><span>${today < 12 ? '' : esc(fmtK(start))}</span><span class="rw-now${today < 12 ? ' at-start' : today > 88 ? ' at-end' : ''}" style="left:${today}%">Today</span><span>${today > 88 ? '' : 'Exam ' + esc(fmtK(end))}</span></div>
    ${compact ? '' : `<div class="rw-legend tiny muted"><span><i class="lgd target"></i>Syllabus target</span>${f && f.completion && f.status !== 'done' ? '<span><i class="lgd fc"></i>Estimated finish</span>' : ''}</div>`}</div>`;
}
function heroHTML(m, d) {
  const S = core().settings, ex = m.ex, hi = greeting() + (S.name ? ', ' + S.name : '');
  const top = `<div class="small muted">${esc(fmtDayLong(d.today))}. ${esc(hi)}.</div>`;
  if (!ex) return `<header class="dash-hero">${top}<h1>No exam selected</h1><p class="lede">Choose or add an exam in <a href="#settings">Settings</a> to get a countdown, a roadmap and a daily plan.</p></header>`;
  const cd = examCountdown(m.cal, ex.date);
  let big;
  if (cd.status === 'upcoming' || cd.status === 'tomorrow') {
    const span = cd.months ? plural(cd.months, 'month') + (cd.monthDays ? ', ' + plural(cd.monthDays, 'day') : '') : cd.weeks ? plural(cd.weeks, 'week') + (cd.weekDays ? ', ' + plural(cd.weekDays, 'day') : '') : '';
    big = `<div class="cd"><span class="num cd-n">${cd.days}</span><div class="cd-t"><span class="cd-u">${cd.days === 1 ? 'day' : 'days'} to ${esc(ex.name)}</span><span class="small muted">${esc(fmtKY(ex.date))}${ex.time ? ', ' + esc(ex.time) : ''}${ex.location ? ', ' + esc(ex.location) : ''}${span ? '. ' + esc(span) : ''}</span></div></div>`;
  } else if (cd.status === 'today') big = `<div class="cd"><div class="cd-t"><span class="cd-u">${esc(ex.name)} is today.</span><span class="small muted">${ex.time ? 'At ' + esc(ex.time) + '. ' : ''}Light review only; you have done the work.</span></div></div>`;
  else if (cd.status === 'past') big = `<div class="cd"><div class="cd-t"><span class="cd-u">${esc(ex.name)} was on ${esc(fmtKY(ex.date))}.</span><span class="small"><a href="#settings">Update the exam date</a> or start a new preparation.</span></div></div>`;
  else big = `<div class="cd"><div class="cd-t"><span class="cd-u">${esc(ex.name)}</span><span class="small"><a href="#settings">Add the exam date</a> to see the countdown and the roadmap.</span></div></div>`;
  const ph = m.phase ? `<p class="lede"><b>${esc(m.phase.name)} phase</b> until ${esc(fmtK(m.phase.end))}. ${esc(m.phase.desc)}</p>` : '';
  const fi = forecastInfo(m);
  return `<header class="dash-hero">${top}${big}${ph}${runwayHTML(m)}<div class="track-line">${toneDot(fi.tone)}<span>${esc(fi.text)}</span><span class="tiny muted">Estimate</span></div></header>`;
}
function recoveryHTML() {
  const d = derive(), c = core();
  if (ui.recoveryOff === d.today) return '';
  const mi = missedInfo(); if (!mi.streak) return '';
  const ctx = planCtx(0), next = [];
  for (let i = 0; i < 14; i++) { const k = addDays(d.today, i); next.push({ k, min: availOn(k) }); }
  const lecMin = sum(mi.days.map(k => { const h = c.planHistory[k]; return h ? sum(h.tasks.filter(t => t.kind === 'lecture').map(t => t.min)) : 0; }));
  const r = recoveryPlan({ missed: mi, overdueReviews: ctx.due.filter(x => x.overdue).length, minPerReview: c.settings.minPerReview, missedLectureMin: lecMin,
    mistakesDue: misDue().length, questionsDue: questionsDueCount(), minPerQuestion: c.prep.minPerQuestion, nextDays: next });
  return `<div class="note recover" role="status"><div class="spread"><b>Welcome back. You missed ${plural(mi.streak, 'planned study day')}.</b><button class="iconbtn" data-a="recovery-off">Hide</button></div>
    <p class="small" style="margin-top:6px">Nothing is stacked onto today. Today's plan starts with the most urgent reviews, then carries on with the next lectures and syllabus in order.</p>
    <ul class="small">${r.lines.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
}
function taskSub(b) {
  if (b.kind === 'lecture' || b.kind === 'selfstudy' || b.kind === 'recall') return b.subjectId ? subjName(b.subjectId) : '';
  if (b.kind === 'qreview') return b.subjectId ? subjName(b.subjectId) : 'Across subjects';
  const s = planBlockSub(b);
  return s || (b.subjectId ? subjName(b.subjectId) : '');
}
function whyHTML(b) {
  return (b.why || []).length ? `<details class="why"><summary>Why this</summary><ul>${b.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : '';
}
function taskRow(p, b) {
  const done = blockDone(b), skipped = b.status === 'skipped', brk = b.kind === 'break';
  const prog = p.progress[b.key] || 0, running = core().active && core().active.blockKey === b.key;
  const time = b.start ? `${b.start}<span class="muted">–${b.end || ''}</span>` : '';
  const tags = (b.locked ? '<span class="tag">Locked</span>' : '') + (b.manual ? '<span class="tag edited">Yours</span>' : '') + (b.fromDay ? `<span class="tag">Moved from ${esc(fmtK(b.fromDay))}</span>` : '');
  let acts;
  if (skipped) acts = `<button class="btn sm ghost" data-a="task-unskip" data-k="${b.key}">Restore</button>`;
  else if (done) acts = `<button class="btn sm ghost" data-a="block-done" data-k="${b.key}">Undo</button>`;
  else if (brk) acts = `<button class="btn sm ghost" data-a="block-done" data-k="${b.key}">Done</button>`;
  else acts = `${running ? '<button class="btn sm live" data-a="focus-open">Running</button>' : `<button class="btn sm primary" data-a="block-start" data-k="${b.key}">Start</button>`}<button class="btn sm" data-a="block-done" data-k="${b.key}">Done</button><button class="btn sm ghost" data-a="task-skip" data-k="${b.key}">Skip</button>`;
  return `<div class="li task${done ? ' done' : ''}${skipped ? ' skipped' : ''}">
    <span class="t-time num">${time}</span><span class="sw k-${b.kind}" aria-hidden="true"></span>
    <div class="grow"><div class="title">${esc(b.title)} ${tags}</div><div class="sub">${esc(KIND_NAME[b.kind] || b.kind)}${taskSub(b) ? ', ' + esc(taskSub(b)) : ''}${prog && !done ? `, ${Math.round(prog)} of ${b.min} min done` : ''}${skipped ? ', skipped' : ''}</div>${brk ? '' : whyHTML(b)}</div>
    <span class="mins num">${b.min}<small>m</small></span>
    <div class="t-acts">${acts}${brk ? '' : `<button class="iconbtn" data-a="task-edit" data-k="${b.key}" aria-label="Edit task">Edit</button>`}</div></div>`;
}
function nextHTML(p, b, d) {
  const a = core().active;
  const real = p.blocks.filter(x => x.kind !== 'break');
  if (!real.length) return `<div class="panel next-card"><div class="sheet-label">Up next</div><h2>${availOn(d.today) ? 'Nothing planned yet' : 'A rest day'}</h2>
    <p class="small muted">${availOn(d.today) ? 'Add subjects or study time and the plan fills in.' : 'No study time is planned for today. Rest is part of the plan.'}</p>
    <div class="row"><button class="btn" data-a="start-open">Start a session anyway</button></div></div>`;
  if (!b) return `<div class="panel next-card"><div class="sheet-label">Up next</div><h2>Today's plan is done</h2><p class="small muted">Anything more is a bonus. A short review or a few saved questions are good uses of spare time.</p>
    <div class="row"><button class="btn" data-a="nav" data-v="review">Review</button><button class="btn" data-a="nav" data-v="practice">Practice</button></div></div>`;
  return `<div class="panel next-card"><div class="sheet-label">Up next${b.start ? ' at ' + esc(b.start) : ''}</div>
    <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="sw k-${b.kind}" style="margin-top:9px" aria-hidden="true"></span><h2>${esc(b.title)}</h2></div>
    <div class="small muted">${esc(KIND_NAME[b.kind])}, ${b.min} min${taskSub(b) ? ', ' + esc(taskSub(b)) : ''}</div>
    ${(b.why || []).length ? `<p class="small">Why: ${esc(b.why.slice(0, 2).join('; '))}.</p>` : ''}
    <div class="row">${a ? '<button class="btn live" data-a="focus-open">Session running</button>' : `<button class="btn primary" data-a="block-start" data-k="${b.key}">Start</button>`}<button class="btn" data-a="block-done" data-k="${b.key}">Mark done</button><button class="btn ghost" data-a="task-skip" data-k="${b.key}">Skip</button></div></div>`;
}
function statusCardHTML(m) {
  const fe = m.feas, lec = m.lec, P = core().prep, lines = [];
  if (fe.status === 'short') lines.push(P.acceptIncomplete
    ? [`warn`, `You chose to keep this schedule: about ${pct(fe.coverage)} of the estimated work fits${fe.atRisk.length ? `; the shortfall falls on ${fe.atRisk.map(x => x.name).join(', ')}` : ''}.`]
    : ['bad', `The syllabus does not fit yet: about ${fmtH(fe.requiredMin)} needed, ${fmtH(fe.availableMin)} available. Short by ${fmtH(fe.gapMin)}.`]);
  else if (fe.status === 'tight') lines.push(['warn', `It fits, just: ${fmtH(fe.requiredMin)} needed, ${fmtH(fe.availableMin)} available.`]);
  else if (fe.status === 'ok') lines.push(['ok', `It fits: about ${fmtH(fe.bufferMin)} of buffer before the exam.`]);
  if (lec.total) lines.push(lec.behindLectures ? ['warn', `Lectures: ${lec.done} of ${lec.total} done, ${plural(lec.behindLectures, 'lecture')} behind the roadmap${lec.behindDays ? ` (${plural(lec.behindDays, 'day')})` : ''}.`]
    : ['ok', `Lectures: ${lec.done} of ${lec.total} done${lec.expectedDone != null ? ', on schedule' : ''}.`]);
  const ctx = planCtx(0), over = ctx.due.filter(x => x.overdue).length;
  if (over > 10) lines.push(['warn', `${over} reviews are overdue. They come first in today's plan.`]);
  const q = questionsDueCount(); if (q) lines.push(['ok', `${plural(q, 'saved question')} due to re-solve.`]);
  return `<div class="panel status-card"><div class="sheet-label">Are you on track?</div><div class="stack" style="gap:8px">${lines.map(([t, x]) => `<div class="track-line small">${toneDot(t)}<span>${esc(x)}</span></div>`).join('') || '<p class="small muted">Add an exam date and subjects to see this.</p>'}</div>
    <div class="row" style="margin-top:12px"><a class="btn sm" href="#plan">Roadmap and options</a></div></div>`;
}
function availOptions(cur) {
  const set = new Set([0, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480, 540, 600, 720].concat(cur || []));
  return [...set].sort((a, b) => a - b).map(v => opt(v, v ? fmtH(v) : 'None', cur)).join('');
}
function todayPlanHTML(p, d) {
  const tasks = p.blocks, real = tasks.filter(t => t.kind !== 'break' && t.status !== 'skipped');
  const planned = sum(real.map(t => t.min)), doneMin = sum(real.filter(t => blockDone(t)).map(t => t.min));
  const strip = real.length ? `<div class="strip" aria-hidden="true">${tasks.filter(t => t.status !== 'skipped').map(t => `<span class="k-${t.kind}${blockDone(t) ? ' done' : ''}" style="flex:${t.min}" title="${esc(t.title)}, ${t.min} min">${t.min >= 25 ? esc(KIND_NAME[t.kind]) : ''}</span>`).join('')}</div>` : '';
  const why = (p.subjects || []).filter(s => N(s.id) && (s.why || []).length);
  return `<section class="block"><div class="spread"><div><h2>Today's plan</h2><p class="small muted">${fmtH(doneMin)} of ${fmtH(planned)} done. Studied today: <span class="live-today">${fmtDur(studiedSec())}</span>.</p></div>
      <div class="row"><label class="row small" style="gap:6px">Time today<select data-c="plan-avail" style="width:auto">${availOptions(p.avail)}</select></label>
        <button class="btn sm" data-a="task-new">Add a task</button><button class="btn sm" data-a="plan-rebuild" title="Tasks you locked, edited, finished or skipped are kept">Regenerate</button></div></div>
    ${strip}
    <div class="panel tight" style="margin-top:12px"><div class="list blocks">${tasks.map(b => taskRow(p, b)).join('') || '<div class="li muted">No tasks.</div>'}</div></div>
    ${(p.notes || []).length ? `<div class="stack small" style="margin-top:10px">${p.notes.map(n => `<div class="note">${esc(n)}</div>`).join('')}</div>` : ''}
    ${why.length ? `<details style="margin-top:10px"><summary>Why these subjects today</summary><ul class="small">${why.map(s => `<li><b>${esc(subjName(s.id))}</b>: ${esc(s.why.join('; '))}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}
function pcard(title, big, sub, frac, tone, href) {
  return `<a class="pcard${tone ? ' ' + tone : ''}" href="${href}"><span class="sheet-label">${title}</span><b class="num">${big}</b><span class="small muted">${sub}</span>${frac != null ? `<span class="bar"><i style="width:${Math.max(0, Math.min(100, frac * 100))}%"></i></span>` : ''}</a>`;
}
function progressHTML(m, d) {
  const c = core(), subSet = new Set(m.subs.map(s => s.id));
  const cs = d.concepts.filter(cn => subSet.has(d.subjOf[cn.id]) && !d.archivedChain[cn.id]);
  const st = cs.map(cn => d.cinfo[cn.id].state), n = cs.length || 0;
  const retrieved = st.filter(s => s >= 3).length, started = st.filter(s => s >= 1).length, stable = st.filter(s => s >= 6).length;
  const since = d.now - 14 * DAY, att = d.qattempts.filter(a => a.at >= since), qs = questionStats(att);
  const pr = d.practice.filter(p => p.at >= since), pn = sum(pr.map(p => p.n)), pc = sum(pr.map(p => p.c));
  const acc = qs.attempted ? qs.accuracy : pn ? pc / pn : null;
  const ctx = planCtx(0), due = ctx.due.length, over = ctx.due.filter(x => x.overdue).length;
  const prepStart = m.phases.length ? m.phases[0].start : m.ex && m.ex.startDate ? m.ex.startDate : d.today;
  let wkStudied = 0, wkAvail = 0; for (let i = 0; i < 7; i++) { const k = addDays(d.today, -i); wkStudied += (d.days[k] ? d.days[k].sec : 0) / 60; if (k >= prepStart) wkAvail += availOn(k); }
  wkStudied += core().active ? studiedSec() / 60 - (d.days[d.today] ? d.days[d.today].sec / 60 : 0) : 0;
  const fe = m.feas, risk = riskList().length;
  const lec = m.lec;
  const cards = [
    pcard('Syllabus', n ? pct(retrieved / n) : m.subs.length ? '–' : '0', n ? `${retrieved} of ${n} concepts recalled at least once; ${started} started, ${stable} stable` : 'Add topics and concepts for concept-level progress', n ? retrieved / n : null, '', '#subjects'),
    lec.total ? pcard('Lectures', `${lec.done}<small>/${lec.total}</small>`, lec.behindLectures ? `${plural(lec.behindLectures, 'lecture')} behind the roadmap` : lec.projectedEnd ? `At your pace, all done by ${fmtK(lec.projectedEnd)}` : lec.doneThisWeek ? plural(lec.doneThisWeek, 'lecture') + ' this week' : 'Watch, self-study and recall each one', lec.pct, lec.behindLectures ? 'warn' : '', '#lectures') : '',
    pcard('Practice', acc == null ? '–' : pct(acc), qs.attempted || pn ? `${qs.attempted + pn} questions in 14 days; ${plural(d.questions.length, 'question')} saved` : 'Log questions to measure application', acc, acc != null && acc < 0.6 ? 'warn' : '', '#practice'),
    pcard('Revision', String(due), due ? `concepts due${over ? `, ${over} overdue` : ''}` : 'Nothing due right now', null, over > 10 ? 'warn' : '', '#review'),
    pcard('Time, last 7 days', fmtH(wkStudied), wkAvail ? `of about ${fmtH(wkAvail)} planned` : 'No study time planned', wkAvail ? wkStudied / wkAvail : null, wkAvail && wkStudied < wkAvail * 0.6 ? 'warn' : '', '#insights'),
    pcard('Risk', fe.status === 'short' && !c.prep.acceptIncomplete ? 'Short' : fe.status === 'tight' ? 'Tight' : fe.status === 'ok' ? 'Fits' : '–', `${fe.status === 'short' ? 'short by ' + fmtH(fe.gapMin) + '. ' : ''}${risk ? plural(risk, 'concept') + ' fading' : 'No fading concepts'}`, null, fe.status === 'short' && !c.prep.acceptIncomplete ? 'bad' : risk > 5 ? 'warn' : '', '#plan')
  ].filter(Boolean);
  return `<section class="block"><div class="spread"><h2>Progress</h2><span class="tiny muted">Estimates from your logged study; they get better with more evidence.</span></div><div class="pgrid">${cards.join('')}</div></section>`;
}
function todayLogHTML(d) {
  const L = todayLearning();
  if (!L.sessions.length && !L.reviews && !L.q) return '';
  return `<section class="block"><h2 style="margin-bottom:10px">Logged today</h2><div class="panel"><div class="stats">
      <div class="stat"><b class="live-today">${fmtDur(studiedSec())}</b><span>studied</span></div><div class="stat"><b>${L.newConcepts}</b><span>new concepts</span></div>
      <div class="stat"><b>${L.reviews}</b><span>recalls${L.reviews ? ', ' + L.reviewOk + ' remembered' : ''}</span></div><div class="stat"><b>${L.q}</b><span>questions${L.q ? ', ' + L.qc + ' correct' : ''}</span></div></div>
    ${L.sessions.length ? `<div class="list" style="margin-top:12px">${L.sessions.slice().reverse().map(sesRow).join('')}</div>` : ''}</div></section>`;
}
export function viewDashboard() {
  const d = derive(), m = model();
  const p = ensurePlan(false);
  const next = p.blocks.find(b => b.kind !== 'break' && !blockDone(b) && b.status !== 'skipped');
  return heroHTML(m, d) + recoveryHTML() + `<div class="dash-grid">${nextHTML(p, next, d)}${statusCardHTML(m)}</div>` + todayPlanHTML(p, d) + progressHTML(m, d) + todayLogHTML(d);
}

/* ================================================================== editing today's plan */

function planTask(key) { const p = core().plan; return p ? p.blocks.find(x => x.key === key) : null; }
/** Gives the unfinished tasks new times inside today's windows (after now); finished and locked ones stay put. */
function reslot() {
  const p = core().plan, d = derive(); if (!p) return;
  p.blocks = slotTasks(p.blocks, windowsOn(d.today), { fromMin: nowMinOfDay() + 5, minSession: core().availability.minSession, id: uid });
}
function commitPlanEdit(msg) { reslot(); Store.touch('core'); render(); if (msg) toast(msg); }
function moveTask(b, k) {
  const c = core(), p = c.plan, d = derive();
  if (!isDateKey(k) || k <= d.today) { toast('Pick a later date.'); return false; }
  if (m0().ex && m0().ex.date && k >= m0().ex.date) { toast('That is on or after the exam date.'); return false; }
  p.blocks = p.blocks.filter(x => x.key !== b.key); delete (p.done || {})[b.key]; delete p.progress[b.key];
  const dp = c.dayPlans[k] || (c.dayPlans[k] = { date: k, avail: availOn(k), base: 0, blocks: [], progress: {} });
  dp.blocks.push(Object.assign({}, b, { key: 'mv' + uid('').slice(-6), id: uid('tk'), start: null, end: null, status: 'todo', manual: true, fromDay: d.today }));
  return true;
}
const m0 = () => model();
function taskModal() {
  const M = ui.modal, b = planTask(M.key); if (!b) return null;
  const f = M.f, subs = examSubjects(false), d = derive();
  const tmr = addDays(d.today, 1);
  return { html: `<div class="mhead"><div><h2>Edit task</h2><p class="small muted">${esc(KIND_NAME[b.kind])}. Changes you make here are kept when the plan is regenerated.</p></div><button class="x" data-a="close" aria-label="Close">×</button></div>
    <label class="f">Title<input type="text" data-c="fv" data-k="title" value="${esc(f.title)}"></label>
    <div class="grid3"><label class="f">Minutes<input type="number" min="5" max="600" step="5" data-c="fv" data-k="min" value="${esc(f.min)}"></label>
      <label class="f">Start at (optional)<input type="time" data-c="fv" data-k="start" value="${esc(f.start)}"></label>
      ${ONE_SUBJECT_KINDS.has(b.kind) ? `<label class="f">Subject<select data-c="fv" data-k="sid">${opt('', 'Any subject', f.sid)}${subs.map(s => opt(s.id, s.name, f.sid)).join('')}</select></label>` : '<span></span>'}</div>
    <label class="check"><input type="checkbox" data-c="fv" data-k="locked"${f.locked ? ' checked' : ''}> Lock: keep this task and its time when the plan is regenerated</label>
    <div><div class="sheet-label">Move to another day</div><div class="row"><button class="btn sm" data-a="task-move" data-v="${tmr}">Tomorrow</button><input type="date" id="task-move-date" min="${tmr}" style="width:auto"><button class="btn sm" data-a="task-move">Move</button></div>
      <p class="tiny muted" style="margin-top:6px">A moved task is kept for that day and planned around. Today's plan is not refilled, so moving work out gives you the time back.</p></div>
    <div class="actions">${b.added ? `<button class="btn danger left" data-a="task-del" data-k="${b.key}">Delete</button>` : `<button class="btn left" data-a="task-skip" data-k="${b.key}">Skip today</button>`}<button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="task-save">Save</button></div>` };
}
function taskNewModal() {
  const f = ui.modal.f, subs = examSubjects(false);
  const kinds = [['new', 'Study (new material)'], ['selfstudy', 'Self-study or revision'], ['practice', 'Practice questions']].concat(core().prep.mode === 'lectures' ? [['lecture', 'Lecture']] : []);
  return { html: `<div class="mhead"><h2>Add a task to today</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
    <div class="grid2"><label class="f">Kind<select data-c="fv" data-k="kind">${kinds.map(k => opt(k[0], k[1], f.kind)).join('')}</select></label>
      <label class="f">Subject<select data-c="fv" data-k="sid">${opt('', 'Any subject', f.sid)}${subs.map(s => opt(s.id, s.name, f.sid)).join('')}</select></label></div>
    <div class="grid2"><label class="f">Title (optional)<input type="text" data-c="fv" data-k="title" value="${esc(f.title)}" placeholder="For example: chapter 4 exercises"></label>
      <label class="f">Minutes<input type="number" min="5" max="600" step="5" data-c="fv" data-k="min" value="${esc(f.min)}"></label></div>
    <div class="actions"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="task-add">Add task</button></div>` };
}

/* ================================================================== PLAN (roadmap, days, calendar, subjects, lectures, practice) */

const PLAN_TABS = [['roadmap', 'Roadmap'], ['days', 'Next 7 days'], ['calendar', 'Calendar'], ['subjects', 'Subjects'], ['lectures', 'Lectures'], ['practice', 'Practice']];
export function viewPlan() {
  const tab = PLAN_TABS.some(t => t[0] === ui.planTab) ? ui.planTab : 'roadmap';
  const body = { roadmap: planRoadmap, days: planDays, calendar: planCalendar, subjects: planSubjects, lectures: planLectures, practice: planPractice }[tab]();
  return `<div class="page-head"><div><h1>Plan</h1><p>From today to the exam: phases, whether everything fits, and the day-by-day plan that follows from it.</p></div>
    <div class="row"><button class="btn" data-a="plan-rebase" title="Save the current roadmap as the baseline your progress is compared with">Re-plan from today</button></div></div>
    <div class="tabs" role="tablist">${PLAN_TABS.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-a="plan-tab" data-v="${k}">${l}</button>`).join('')}</div>${body}`;
}
function feasibilityHTML(m) {
  const fe = m.feas, P = core().prep;
  if (fe.status === 'no-date') return `<div class="note">Add the exam date in <a href="#settings">Settings</a> to check whether the syllabus fits the time you have.</div>`;
  if (fe.status === 'past') return `<div class="note">The exam date has passed. Update it in <a href="#settings">Settings</a>.</div>`;
  const head = fe.status === 'short'
    ? `<div class="note red"><b>This does not fit yet.</b> Your roadmap requires about ${fmtH(fe.requiredMin)}. You have about ${fmtH(fe.availableMin)} of study time before the exam (${plural(fe.studyDays, 'study day')}), so you are short by about ${fmtH(fe.gapMin)}.</div>`
    : fe.status === 'tight' ? `<div class="note">It fits, just: about ${fmtH(fe.requiredMin)} required, ${fmtH(fe.availableMin)} available. There is little room for missed days.</div>`
    : `<div class="note green">It fits: about ${fmtH(fe.requiredMin)} required, ${fmtH(fe.availableMin)} available, leaving about ${fmtH(fe.bufferMin)} of buffer.</div>`;
  const adj = [];
  if (P.effort === 'extra') adj.push(chip(`Extra effort: +${P.extraMinPerDay} min a study day ×`, true, 'data-a="feas-undo" data-v="effort"'));
  if (P.dropLowImportance) adj.push(chip('Low-importance content left out ×', true, 'data-a="feas-undo" data-v="drop"'));
  if (P.practiceScale < 1) adj.push(chip(`Practice target at ${Math.round(P.practiceScale * 100)}% ×`, true, 'data-a="feas-undo" data-v="practice"'));
  if (P.acceptIncomplete) adj.push(chip('Accepting incomplete coverage ×', true, 'data-a="feas-undo" data-v="accept"'));
  let opts = '';
  const extraNow = P.effort === 'extra' ? P.extraMinPerDay || 0 : 0;
  const baseAvail = Math.max(0, fe.availableMin - extraNow * fe.studyDays), basePer = Math.max(0, fe.currentPerStudyDay - extraNow);
  const need = fe.studyDays ? Math.max(0, Math.ceil((fe.requiredMin - baseAvail) / fe.studyDays / 5) * 5) : 0;
  const effortCards = (fe.status === 'short' || extraNow) && need > 0 ? `<div class="effort-pair">
      <button class="opt-card${P.effort !== 'extra' ? ' selected' : ''}" data-a="feas-effort" data-v="normal" aria-pressed="${P.effort !== 'extra'}"><span class="opt-title">Normal plan</span><span class="opt-desc">${fmtH(basePer)} a study day. About ${pct(fe.requiredMin ? Math.min(1, baseAvail / fe.requiredMin) : 1)} of the estimated work fits.</span></button>
      <button class="opt-card${P.effort === 'extra' ? ' selected' : ''}" data-a="feas-effort" data-v="extra" data-n="${Math.min(900, need)}" aria-pressed="${P.effort === 'extra'}"><span class="opt-title">Extra effort plan</span><span class="opt-desc">${fmtH(basePer + need)} a study day (+${need} min). ${basePer + need > 720 ? 'More than 12 hours a day is not realistic; combine extra time with the other changes, or accept that not everything fits.' : 'Covers everything if you keep it up.'}</span></button></div>` : '';
  if (fe.status === 'short') {
    opts = `<div class="list">${fe.options.filter(o => o.key !== 'extra-daily').map(o => `<div class="li"><div class="grow"><div class="title">${esc(o.label)}</div><div class="sub" style="white-space:normal">${esc(o.detail)}${o.gainMin ? ` Gains about ${fmtH(o.gainMin)}${o.closesGap ? ', enough to close the gap' : ''}.` : ''}</div></div>
        <button class="btn sm" data-a="feas-apply" data-v="${o.key}"${o.value != null ? ` data-n="${o.value}"` : ''}>${o.key === 'accept' ? 'Keep as is' : o.key === 'prioritize' ? 'Reorder' : 'Apply'}</button></div>`).join('')}
        <div class="li"><div class="grow"><div class="title">Move the exam date later</div><div class="sub" style="white-space:normal">Only if the date is really yours to choose, for example a self-set target.</div></div><a class="btn sm" href="#settings">Change date</a></div></div>`;
  }
  return `<div class="stack">${head}${adj.length ? `<div><div class="sheet-label">Your adjustments</div><div class="chips">${adj.join('')}</div></div>` : ''}${effortCards}${opts}</div>`;
}
function planRoadmap() {
  const m = model(), c = core(), w = m.work;
  if (!m.ex) return `<div class="empty"><p>No exam is active.</p><a class="btn" href="#settings">Choose an exam</a></div>`;
  const fi = forecastInfo(m);
  const phases = m.phases.map(p => { const on = m.phase && m.phase.key === p.key, past = p.end < m.cal;
    return `<div class="li${past ? ' past' : ''}"><span class="sw ph-${p.key}" aria-hidden="true"></span><div class="grow"><div class="title">${esc(p.name)} ${on ? '<span class="tag blue">Now</span>' : ''}</div><div class="sub" style="white-space:normal">${esc(p.desc)}</div></div>
      <span class="small muted" style="text-align:right">${esc(fmtK(p.start))} to ${esc(fmtK(p.end))}<br>${plural(daysBetween(p.start, p.end) + 1, 'day')}</span></div>`; }).join('');
  const wrows = w.subjects.map(s => `<tr><td>${esc(s.name)}${s.optional ? ' <span class="tag">Left out</span>' : ''}</td><td class="n">${fmtH(s.learnMin)}</td><td class="n">${fmtH(s.practiceMin)}</td><td class="n">${fmtH(s.revisionMin)}</td><td class="n">${fmtH(s.mistakesMin)}</td><td class="n"><b>${fmtH(s.totalMin)}</b></td></tr>`).join('');
  const base = c.roadmap;
  return `<section style="margin-top:0">${runwayHTML(m)}<div class="track-line" style="margin-top:10px">${toneDot(fi.tone)}<span>${esc(fi.text)}</span><span class="tiny muted">Estimate</span></div></section>
    <section class="block"><h2 style="margin-bottom:10px">Does it fit?</h2>${feasibilityHTML(m)}</section>
    <section class="block"><h2 style="margin-bottom:10px">Phases</h2><div class="panel tight"><div class="list">${phases || '<div class="li muted">Add the exam date to see phases.</div>'}</div></div>
      <p class="tiny muted" style="margin-top:8px">Phases are compressed when the exam is close: under three weeks there is no separate foundation phase, and the last week is always final preparation.</p></section>
    <section class="block"><div class="spread"><h2>Estimated work remaining</h2><span class="tiny muted">${base ? 'Baseline saved ' + esc(new Date(base.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })) : 'No baseline yet'}</span></div>
      <div class="panel scroll-x"><table class="t"><thead><tr><th>Subject</th><th class="n">Learning</th><th class="n">Practice</th><th class="n">Revision</th><th class="n">Mistakes</th><th class="n">Total</th></tr></thead>
        <tbody>${wrows}<tr><td><b>All subjects</b></td><td class="n">${fmtH(w.learnMin)}</td><td class="n">${fmtH(w.practiceMin)}</td><td class="n">${fmtH(w.revisionMin)}</td><td class="n">${fmtH(w.mistakesMin)}</td><td class="n"><b>${fmtH(w.totalMin)}</b></td></tr></tbody></table></div>
      <details style="margin-top:10px"><summary>How this is estimated</summary><ul class="small muted">${w.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}<li>These are planning estimates, not predictions. They update as you log study, lectures and practice.</li></ul></details></section>`;
}
function dayCard(day, i) {
  const k = day.date, real = (day.tasks || []).filter(t => t.kind !== 'break'), min = sum(real.filter(t => t.status !== 'skipped').map(t => t.min));
  const ph = phaseOn(model().phases, k), avail = availOn(k);
  const rows = (day.tasks || []).filter(t => t.kind !== 'break').map(t => `<div class="li"><span class="t-time num">${t.start || ''}</span><span class="sw k-${t.kind}" aria-hidden="true"></span>
    <div class="grow"><div class="title">${esc(t.title)} ${t.manual && !day.today ? '<span class="tag edited">Yours</span>' : ''}</div><div class="sub">${esc(KIND_NAME[t.kind])}${taskSub(t) ? ', ' + esc(taskSub(t)) : ''}</div></div>
    <span class="mins num">${t.min}<small>m</small></span>${t.manual && !day.today ? `<button class="iconbtn" data-a="dayplan-del" data-k="${k}" data-v="${t.key}">Remove</button>` : ''}</div>`).join('');
  return `<div class="panel tight day-card${day.today ? ' today' : ''}"><div class="spread"><div><b>${day.today ? 'Today' : i === 1 ? 'Tomorrow' : esc(fmtKW(k))}</b> <span class="small muted">${day.today ? esc(fmtKW(k)) : ''}${ph ? (day.today ? ', ' : '') + esc(ph.name) : ''}</span></div>
    <span class="small muted">${avail ? `${fmtH(min)} planned of ${fmtH(avail)}` : 'Rest day'}</span></div>
    ${rows ? `<div class="list blocks">${rows}</div>` : `<p class="small muted" style="margin-top:6px">${avail ? 'Nothing planned.' : 'No study planned. Enjoy it.'}</p>`}</div>`;
}
function planDays() {
  const days = projectWeek(7);
  return `<p class="small muted" style="margin-bottom:12px">The coming days, planned as if you complete each day's plan. They are recalculated from your real progress every morning, so treat them as a preview. Tasks you move to a day are kept for it.</p>
    <div class="stack">${days.map(dayCard).join('')}</div>`;
}
function planCalendar() {
  const m = model(), d = derive(), A = core().availability, ex = m.ex;
  const first = (ui.planMonth || d.today.slice(0, 7)) + '-01';
  const f = keyToDate(first), y = f.getFullYear(), mo = f.getMonth();
  const startDow = (f.getDay() + 6) % 7, days = new Date(y, mo + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push('<span></span>');
  for (let n = 1; n <= days; n++) {
    const k = first.slice(0, 8) + String(n).padStart(2, '0'), ph = phaseOn(m.phases, k);
    const isEx = ex && ex.date === k, un = A.unavailable.includes(k), rest = A.restDays.includes(weekdayOf(k));
    const st = d.days[k] ? d.days[k].sec / 60 : 0, av = availOn(k);
    const past = k < d.today;
    cells.push(`<button class="${k === d.today ? 'today ' : ''}${past ? 'past ' : ''}${un ? 'unav ' : ''}${isEx ? 'exam' : ''}" data-a="plan-unav" data-k="${k}"${past || isEx ? ' disabled' : ''} title="${past ? '' : un ? 'Marked as unavailable. Click to make it a study day again.' : 'Click to mark this date as unavailable.'}">
      ${ph ? `<i class="cal-ph ph-${ph.key}"></i>` : ''}<span class="d">${n}</span>
      ${isEx ? '<span class="x">Exam</span>' : past ? (st ? `<span class="m">${fmtH(st)}</span>` : '<span class="tiny muted">–</span>') : un ? '<span class="tiny">Unavailable</span>' : av ? `<span class="r">${fmtH(av)}</span>` : `<span class="tiny muted">${rest ? 'Rest' : 'Off'}</span>`}</button>`);
  }
  const label = f.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return `<div class="spread" style="margin-bottom:12px"><div class="row"><button class="btn sm" data-a="plan-month" data-v="-1" aria-label="Previous month">Previous</button><b>${esc(label)}</b><button class="btn sm" data-a="plan-month" data-v="1" aria-label="Next month">Next</button>${ui.planMonth ? '<button class="btn sm ghost" data-a="plan-month" data-v="0">This month</button>' : ''}</div>
    <div class="row tiny muted">${m.phases.map(p => `<span class="row" style="gap:5px"><i class="sw ph-${p.key}"></i>${esc(p.name)}</span>`).join('')}</div></div>
    <div class="cal pcal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<span class="dow">${x}</span>`).join('')}${cells.join('')}</div>
    <p class="tiny muted" style="margin-top:8px">Past days show time studied; coming days show planned study time. Click a coming date to mark it as unavailable (travel, an event, illness); the roadmap and feasibility adjust.</p>`;
}
function planSubjects() {
  const m = model(), d = derive(), base = core().roadmap, rows = m.timeline.rows || {};
  if (!m.subs.length) return '<div class="empty"><p>No subjects yet.</p><a class="btn" href="#subjects">Add subjects</a></div>';
  const ex = m.ex, start = m.cal, end = ex && ex.date && ex.date > start ? ex.date : addDays(start, 60), T = Math.max(1, daysBetween(start, end));
  const pos = k => Math.max(0, Math.min(100, daysBetween(start, k) / T * 100));
  const wl = {}; m.work.subjects.forEach(s => { wl[s.id] = s; });
  const out = m.order.map(id => {
    const s = N(id); if (!s) return '';
    const r = rows[id], b = base && base.subjects && base.subjects[id], lf = conceptsUnder(id).filter(cn => !d.archivedChain[cn.id]);
    const learned = lf.length ? lf.filter(cn => d.cinfo[cn.id].state >= 3).length / lf.length : null;
    const bar = r && r.start && r.end ? `<i class="g-bar" style="left:${pos(r.start)}%;width:${Math.max(1.5, pos(r.end) - pos(r.start))}%;background:${s.color || 'var(--blue)'}"></i>` : '';
    const ghost = b && b.start && b.end ? `<i class="g-base" style="left:${pos(b.start)}%;width:${Math.max(1.5, pos(b.end) - pos(b.start))}%"></i>` : '';
    const tgt = s.targetDate && s.targetDate >= start && s.targetDate <= end ? `<i class="g-tgt" style="left:${pos(s.targetDate)}%" title="Finish by ${esc(fmtK(s.targetDate))}"></i>` : '';
    const late = s.targetDate && r && r.end && r.end > s.targetDate;
    const pre = (s.prereqSubjects || []).map(x => N(x)).filter(Boolean).map(x => x.name);
    return `<div class="g-row"><div class="g-name"><span class="dot" style="background:${s.color || 'var(--faint)'}"></span><div><div class="title">${esc(s.name)}</div><div class="tiny muted">${esc(windowText(r))}${learned != null ? `, ${pct(learned)} recalled` : ''}${pre.length ? `, after ${esc(pre.join(', '))}` : ''}${wl[id] ? `, ${fmtH(wl[id].learnMin)} left (est.)` : ''}${late ? ` <span class="bad">ends after its target ${esc(fmtK(s.targetDate))}</span>` : ''}</div></div></div>
      <div class="g-track">${ghost}${bar}${tgt}</div></div>`;
  }).join('');
  return `<p class="small muted" style="margin-bottom:12px">When each subject's new learning is planned, in roadmap order (prerequisites first, then priority and importance). Revision and practice continue after these bars end.${base ? ' The outline shows the saved baseline.' : ''}</p>
    <div class="panel gantt"><div class="g-row g-head"><span></span><div class="g-track"><span>${esc(fmtK(start))}</span><span>${ex && ex.date ? 'Exam ' + esc(fmtK(end)) : esc(fmtK(end))}</span></div></div>${out}</div>`;
}
function planLectures() {
  const d = derive(), m = model(), c = core(), subs = m.subs.filter(s => d.lectures.some(l => l.subjectId === s.id));
  if (!subs.length) return `<div class="empty"><p>No lectures yet. If you follow a lecture course, add the lectures per subject and each one is planned as watch, self-study and recall.</p><a class="btn" href="#lectures">Set up lectures</a></div>`;
  const rows = subs.map(s => {
    const ls = d.lectures.filter(l => l.subjectId === s.id);
    const st = lectureStats(ls, d.today, { sh: d.sh, defaultMin: c.prep.defaultLectureMin, baseline: c.roadmap, evidence: d.lecEvidence });
    const planned = c.roadmap && c.roadmap.lectures ? ls.map(l => c.roadmap.lectures[l.id]).filter(Boolean).sort().pop() : null;
    return `<tr><td><span class="dot" style="background:${s.color || 'var(--faint)'}"></span> <a href="#lectures" data-a="lec-goto" data-id="${s.id}">${esc(s.name)}</a></td><td class="n">${st.done}/${st.total}</td><td class="n">${st.inProgress}</td>
      <td class="n">${st.perDay14 ? (st.perDay14 * 7).toFixed(1) : '0'}</td><td>${planned ? esc(fmtK(planned)) : '–'}</td><td>${st.projectedEnd ? esc(fmtK(st.projectedEnd)) : st.remaining ? '–' : 'Done'}</td>
      <td>${st.behindLectures ? `<span class="bad">${plural(st.behindLectures, 'lecture')} behind${st.behindDays ? ', ' + plural(st.behindDays, 'day') : ''}</span>` : st.expectedDone != null ? 'On schedule' : '–'}</td></tr>`;
  }).join('');
  const L = m.lec;
  return `<div class="stats" style="margin-bottom:16px"><div class="stat"><b>${L.done}<small>/${L.total}</small></b><span>lectures covered</span></div><div class="stat"><b>${L.inProgress}</b><span>in progress</span></div>
    <div class="stat"><b>${fmtH(L.remainingMin)}</b><span>left to watch (est.)</span></div><div class="stat"><b>${L.doneThisWeek}</b><span>this week</span></div>
    <div class="stat"><b class="${L.behindLectures ? 'bad' : ''}">${L.behindLectures || 0}</b><span>behind the roadmap</span></div></div>
    <div class="panel scroll-x"><table class="t"><thead><tr><th>Subject</th><th class="n">Done</th><th class="n">In progress</th><th class="n">Per week</th><th>Planned finish</th><th>At your pace</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="tiny muted" style="margin-top:8px">A lecture counts as covered after watching plus self-study or recall, or when you mark it complete. Pace is the last 14 days. Planned dates come from the saved baseline; use "Re-plan from today" to reset it.</p>`;
}
function planPractice() {
  const d = derive(), m = model(), c = core();
  const rows = m.subs.map(s => {
    const qs = d.questions.filter(q => (q.subjectId || d.subjOf[q.conceptId]) === s.id), ids = new Set(qs.map(q => q.id));
    const st = questionStats(d.qattempts.filter(a => ids.has(a.qid)));
    const cs = conceptsUnder(s.id).filter(cn => !d.archivedChain[cn.id]);
    const sig = cs.map(cn => { const i = d.cinfo[cn.id]; return { cn, s: practiceSignal({ practice: i.ix.practice, recall: i.R, state: i.state }) }; });
    const weak = sig.filter(x => x.s.signal === 'weak-application'), strong = sig.filter(x => x.s.signal === 'strong');
    const due = qs.filter(q => c.qmem[q.id] && c.qmem[q.id].due < dayStart(addDays(d.today, 1), d.sh)).length;
    return { s, n: qs.length, st, weak, strong, due };
  });
  const weakAll = rows.flatMap(r => r.weak.map(x => ({ ...x, sid: r.s.id }))).slice(0, 12);
  return `<div class="panel scroll-x"><table class="t"><thead><tr><th>Subject</th><th class="n">Saved questions</th><th class="n">Attempts</th><th class="n">Accuracy</th><th class="n">Due</th><th class="n">Weak application</th><th class="n">Strong</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td><span class="dot" style="background:${r.s.color || 'var(--faint)'}"></span> ${esc(r.s.name)}</td><td class="n">${r.n}</td><td class="n">${r.st.attempted}</td><td class="n">${r.st.accuracy == null ? '–' : pct(r.st.accuracy)}</td><td class="n">${r.due}</td><td class="n">${r.weak.length}</td><td class="n">${r.strong.length}</td></tr>`).join('')}</tbody></table></div>
    <section class="block"><h2 style="margin-bottom:6px">Understood but not yet applied well</h2><p class="small muted" style="margin-bottom:10px">Recall is fine but practice accuracy is low. The planner gives these more practice and less passive study.</p>
      ${weakAll.length ? `<div class="panel tight"><div class="list">${weakAll.map(x => `<div class="li clickable" data-a="concept" data-id="${x.cn.id}" data-tab="practice"><span class="dot" style="background:${subjColor(x.sid)}"></span><div class="grow"><div class="title">${esc(x.cn.name)}</div><div class="sub">${esc(x.s.note)}</div></div><span class="small">${x.s.accuracy == null ? '' : pct(x.s.accuracy)}</span></div>`).join('')}</div></div>` : '<p class="small muted">None detected. That can also mean there is little practice logged yet.</p>'}
      <div class="row" style="margin-top:12px"><a class="btn" href="#practice">Open practice</a></div></section>`;
}

/* ================================================================== SUBJECTS: roadmap order and the subject dashboard */

/** A subject's planned learning window, in words. */
function windowText(r) {
  if (!r) return 'Not planned';
  if (r.learnMin <= 0) return 'New learning done';
  if (r.start && r.end) return `${fmtK(r.start)} to ${fmtK(r.end)}`;
  if (r.start) return `From ${fmtK(r.start)}; does not finish before the exam at this pace`;
  return 'Not reached before the exam at this pace';
}
export function viewSubjectRoadmap() {
  const m = model(), rows = m.timeline.rows || {}, wl = {};
  m.work.subjects.forEach(s => { wl[s.id] = s; });
  if (!m.subs.length) return '<div class="empty"><p>No subjects yet.</p></div>';
  const cur = examSubjects(false).map(s => s.id).join(), same = cur === m.order.join();
  return `<p class="small muted" style="margin-bottom:12px">The order new learning follows: subjects you marked as prerequisites come first, then higher priority and importance, then your own order. Several subjects run in parallel when you study more than one a day.</p>
    <div class="panel tight"><div class="list">${m.order.map((id, i) => { const s = N(id); if (!s) return ''; const r = rows[id]; const pre = (s.prereqSubjects || []).map(x => N(x)).filter(Boolean);
      return `<div class="li clickable" data-a="nav" data-v="subject/${s.id}"><span class="num" style="width:28px;font-size:22px">${i + 1}</span><span class="dot" style="background:${s.color || 'var(--faint)'}"></span>
        <div class="grow"><div class="title">${esc(s.name)}</div><div class="sub">${pre.length ? 'After ' + esc(pre.map(x => x.name).join(', ')) + '. ' : ''}${['', 'Low', 'Medium', 'High'][s.imp || 2]} importance, ${['', 'later', 'normal', 'do first'][s.priority || 2]} priority${s.targetDate ? '. Finish by ' + esc(fmtK(s.targetDate)) : ''}</div></div>
        <span class="small muted" style="text-align:right">${esc(windowText(r))}<br>${wl[id] ? fmtH(wl[id].learnMin) + ' left (est.)' : ''}</span></div>`; }).join('')}</div></div>
    <div class="row" style="margin-top:12px">${same ? '<span class="small muted">Your subject list already follows this order.</span>' : '<button class="btn" data-a="roadmap-apply">Reorder my subject list to match</button>'}<a class="btn ghost" href="#plan">Open the full roadmap</a></div>`;
}
export function subjectDashboardHTML(sid, st) {
  const d = derive(), m = model(), s = N(sid); if (!s) return '';
  const w = m.work.subjects.find(x => x.id === sid), r = (m.timeline.rows || {})[sid];
  const ls = d.lectures.filter(l => l.subjectId === sid), ldone = ls.filter(l => d.lecProg[l.id].covered).length;
  const qs = d.questions.filter(q => (q.subjectId || d.subjOf[q.conceptId]) === sid), qids = new Set(qs.map(q => q.id));
  const qst = questionStats(d.qattempts.filter(a => qids.has(a.qid)));
  const wa = st.cs.filter(cn => { const i = d.cinfo[cn.id]; return i && practiceSignal({ practice: i.ix.practice, recall: i.R, state: i.state }).signal === 'weak-application'; }).length;
  const late = s.targetDate && r && r.end && r.end > s.targetDate;
  const lines = [];
  if (r && r.learnMin <= 0) lines.push('New learning is done; revision and practice continue.');
  else if (r && r.start) lines.push(`New learning planned ${windowText(r).toLowerCase()}${late ? `, after the target of ${fmtK(s.targetDate)}` : ''}.`);
  else if (r) lines.push('At the planned pace, new learning in this subject does not start before the exam.');
  if (s.targetDate && !late) lines.push(`Target: finish learning by ${fmtK(s.targetDate)}.`);
  if (w) lines.push(w.source === 'estimate' ? 'Work left is based on your hour estimate.' : w.source === 'structure' ? 'Work left is estimated from its concepts' + (ls.length ? ' and lectures.' : '.') : 'Work left uses a default size because the subject has no topics or hour estimate yet; add either for a better figure.');
  return `<div class="panel"><div class="stats">
      <div class="stat"><b>${st.retrieved}<small>/${st.cs.length}</small></b><span>concepts recalled</span></div>
      <div class="stat"><b>${st.mastery == null ? '–' : pct(st.mastery)}</b><span>${st.mastery == null ? 'mastery: too early' : 'est. mastery'}</span></div>
      <div class="stat"><b>${fmtDur(st.sec)}</b><span>studied</span></div>
      ${ls.length ? `<div class="stat"><b>${ldone}<small>/${ls.length}</small></b><span>lectures covered</span></div>` : ''}
      <div class="stat"><b>${qst.accuracy == null ? '–' : pct(qst.accuracy)}</b><span>${qst.attempted ? plural(qst.attempted, 'question attempt') : 'no questions yet'}</span></div>
      <div class="stat"><b>${st.due.length}</b><span>due for review</span></div>
      ${wa ? `<div class="stat"><b class="bad">${wa}</b><span>weak on practice</span></div>` : ''}
      ${w ? `<div class="stat"><b>${fmtH(w.totalMin)}</b><span>work left (est.)</span></div>` : ''}</div>
    ${lines.length ? `<p class="small ${late ? 'bad' : 'muted'}" style="margin-top:12px">${esc(lines.join(' '))}</p>` : ''}</div>`;
}

/* ================================================================== WEEKLY REVIEW */

function weekInput(off) {
  const d = derive(), c = core(), m = model();
  const to = addDays(d.today, -7 * off), from = addDays(to, -6), keys = [];
  for (let k = from; k <= to; k = addDays(k, 1)) keys.push(k);
  const inR = ts => { if (!ts) return false; const k = dayKey(ts, d.sh); return k >= from && k <= to; };
  let plannedMin = 0, tasksDone = 0, tasksSkipped = 0, tasksPlanned = 0;
  const perDay = keys.map(k => {
    let pm = 0;
    if (k === d.today && c.plan && c.plan.date === k) {
      const real = c.plan.blocks.filter(b => b.kind !== 'break');
      pm = sum(real.filter(b => b.status !== 'skipped').map(b => b.min)); tasksPlanned += real.length;
      tasksDone += real.filter(b => blockDone(b)).length; tasksSkipped += real.filter(b => b.status === 'skipped').length;
    } else if (c.planHistory[k]) {
      const h = c.planHistory[k], real = h.tasks.filter(t => t.kind !== 'break');
      pm = h.plannedMin; tasksPlanned += real.length; tasksDone += real.filter(t => t.status === 'done').length; tasksSkipped += real.filter(t => t.status === 'skipped').length;
    }
    plannedMin += pm;
    return { k, planned: pm, studied: k === d.today ? studiedSec() / 60 : (d.days[k] ? d.days[k].sec / 60 : 0) };
  });
  const att = d.qattempts.filter(a => inR(a.at)), pr = d.practice.filter(p => inR(p.at) && !p.qid);
  const rv = d.reviews.filter(r => inR(r.at));
  const subjects = m.subs.map(s => {
    const min = sum(keys.map(k => d.days[k] && d.days[k].subj[s.id] ? d.days[k].subj[s.id] / 60 : 0));
    const sp = pr.filter(p => d.subjOf[p.cid] === s.id), sa = att.filter(a => { const q = d.qById[a.qid]; return q && (q.subjectId || d.subjOf[q.conceptId]) === s.id; });
    const n = sum(sp.map(p => p.n)) + sa.length, cc = sum(sp.map(p => p.c)) + sum(sa.map(a => a.result === 'correct' ? 1 : a.result === 'partial' ? 0.5 : 0));
    return { id: s.id, name: s.name, min, targetShare: m.shares.dyn[s.id] || 0, accuracy: n ? cc / n : null, evidence: n };
  });
  const ctx = planCtx(0), nx = [];
  for (let i = 1; i <= 7; i++) nx.push(addDays(d.today, i));
  const base = c.roadmap && c.roadmap.lectures ? c.roadmap.lectures : {};
  const lecNext = d.lectures.filter(l => !d.lecProg[l.id].covered && base[l.id] && base[l.id] <= nx[6]).length || Math.round((m.lec.perDay14 || 0) * 7);
  const end7 = dayStart(addDays(d.today, 8), d.sh);
  return { review: buildWeeklyReview({ from, to, plannedMin, studiedMin: sum(perDay.map(x => x.studied)), tasksDone, tasksSkipped, tasksPlanned,
    lecturesDone: d.lectures.filter(l => { const p = d.lecProg[l.id]; return p.covered && inR(p.completedAt); }).length,
    questions: { attempted: att.length + sum(pr.map(p => p.n)), correct: Math.round(att.filter(a => a.result === 'correct').length + sum(pr.map(p => p.c))) },
    reviews: { done: rv.length, ok: rv.filter(r => r.g >= 2).length }, mistakesResolved: d.mistakes.filter(x => x.resolved && inR(x.resolvedAt || x.updatedAt)).length,
    subjects, backlog: { overdueReviews: ctx.due.filter(x => x.overdue).length, overdueQuestions: questionsDueCount(), lecturesBehind: m.lec.behindLectures, mistakesDue: misDue().length },
    nextWeek: { availableMin: sum(nx.map(availOn)), studyDays: nx.filter(k => availOn(k) > 0).length, lectureTarget: lecNext,
      reviewsDue: Object.values(c.mem).filter(x => x && x.due && x.due < end7).length } }), perDay };
}
export function viewWeek() {
  const off = Math.max(0, ui.weekOff || 0), { review: w, perDay } = weekInput(off), d = derive();
  const mx = Math.max(30, ...perDay.map(x => Math.max(x.planned, x.studied)));
  const bars = perDay.map(x => `<div class="wk-day"><div class="wk-bars"><i class="pl" style="height:${x.planned / mx * 100}%" title="Planned ${fmtH(x.planned)}"></i><i class="st" style="height:${x.studied / mx * 100}%" title="Studied ${fmtH(x.studied)}"></i></div><span class="tiny${x.k === d.today ? ' b' : ' muted'}">${DOW[weekdayOf(x.k)]}</span><span class="tiny muted">${fmtH(x.studied)}</span></div>`).join('');
  const tot = sum(w.subjects.map(s => s.min)) || 1;
  const srows = w.subjects.map(s => `<tr><td><span class="dot" style="background:${subjColor(s.id)}"></span> ${esc(s.name)}</td><td class="n">${fmtH(s.min)}</td><td class="n">${pct(s.min / tot)}</td><td class="n">${pct(s.targetShare)}</td><td class="n">${s.accuracy == null ? '–' : pct(s.accuracy) + ` <span class="tiny muted">(${s.evidence})</span>`}</td></tr>`).join('');
  const f = w.focus;
  return `<div class="page-head"><div><h1>Weekly review</h1><p>${esc(fmtKW(w.from))} to ${esc(fmtKW(w.to))}. What you planned, what you did, and what the next week should focus on.</p></div>
    <div class="row"><button class="btn sm" data-a="week-off" data-v="1">Previous week</button>${off ? '<button class="btn sm" data-a="week-off" data-v="-1">Next week</button>' : ''}</div></div>
    <div class="panel"><div class="stats">
      <div class="stat"><b>${fmtH(w.studiedMin)}</b><span>studied${w.plannedMin ? ' of ' + fmtH(w.plannedMin) + ' planned' : ''}</span></div>
      <div class="stat"><b>${w.completion == null ? '–' : pct(w.completion)}</b><span>${w.tasksPlanned ? `${w.tasksDone} of ${w.tasksPlanned} tasks done` : 'no tasks recorded'}${w.tasksSkipped ? ', ' + w.tasksSkipped + ' skipped' : ''}</span></div>
      <div class="stat"><b>${w.lecturesDone}</b><span>lectures covered</span></div>
      <div class="stat"><b>${w.accuracy == null ? '–' : pct(w.accuracy)}</b><span>${w.questions.attempted ? plural(w.questions.attempted, 'question') : 'no questions'}</span></div>
      <div class="stat"><b>${w.reviews.done ? pct(w.reviews.ok / w.reviews.done) : '–'}</b><span>${plural(w.reviews.done, 'recall')} remembered</span></div>
      <div class="stat"><b>${w.mistakesResolved}</b><span>mistakes resolved</span></div></div>
      <div class="wk-chart" aria-label="Planned and studied time per day">${bars}</div><div class="tiny muted"><i class="lgd pl"></i> planned <i class="lgd st"></i> studied</div></div>
    <section class="block"><h2 style="margin-bottom:10px">Subjects</h2><div class="panel scroll-x"><table class="t"><thead><tr><th>Subject</th><th class="n">Time</th><th class="n">Share</th><th class="n">Target share</th><th class="n">Accuracy (answers)</th></tr></thead><tbody>${srows}</tbody></table></div>
      <p class="small" style="margin-top:10px">${w.strongest ? `Strongest: <b>${esc(w.strongest)}</b>. ` : ''}${w.weakest ? `Weakest: <b>${esc(w.weakest)}</b>.` : w.strongest ? '' : '<span class="muted">Not enough answers yet to call strongest and weakest subjects (5 per subject).</span>'}</p></section>
    ${off ? '' : `<section class="block"><h2 style="margin-bottom:10px">Next week</h2><div class="panel stack">
      <div class="stats"><div class="stat"><b>${f.minutesPerDay ? fmtH(f.minutesPerDay) : '–'}</b><span>a study day (${plural(w.nextWeek.studyDays, 'day')})</span></div>
        <div class="stat"><b>${f.lectures}</b><span>lectures to cover</span></div><div class="stat"><b>${f.questions}</b><span>questions to attempt</span></div><div class="stat"><b>${w.nextWeek.reviewsDue}</b><span>reviews coming due</span></div></div>
      ${f.subjects.length ? `<p>Give more time to <b>${esc(f.subjects.join(' and '))}</b>: ${f.subjects.length > 1 ? 'they are' : 'it is'} behind ${f.subjects.length > 1 ? 'their' : 'its'} target share or weak on practice.</p>` : '<p class="small muted">Time across subjects matched the targets this week.</p>'}
      ${f.notes.length ? f.notes.map(n => `<div class="note small">${esc(n)}</div>`).join('') : ''}
      ${w.backlog.overdueReviews || w.backlog.mistakesDue || w.backlog.overdueQuestions ? `<p class="small muted">Backlog now: ${plural(w.backlog.overdueReviews, 'overdue review')}, ${plural(w.backlog.mistakesDue, 'mistake')} due, ${plural(w.backlog.overdueQuestions, 'saved question')} due.</p>` : ''}
      <div class="row"><a class="btn" href="#plan">Open the roadmap</a><button class="btn" data-a="plan-tab" data-v="days">Preview the next 7 days</button></div></div></section>`}`;
}

/* ================================================================== SETTINGS: preparation */

function setPath(o, path, v) { const k = path.split('.'); let x = o; for (let i = 0; i < k.length - 1; i++) x = x[k[i]] || (x[k[i]] = {}); x[k[k.length - 1]] = v; }
function typed(el) { const t = el.dataset.t; if (el.type === 'checkbox') return el.checked; if (t === 'num') { const n = parseFloat(el.value); return isFinite(n) ? n : null; } return el.value; }
function prepChanged(msg) {
  const c = core(); c.availability = normAvailability(c.availability, c.availability.weekday.minutes);
  Store.touch('core'); invalidate();
  const d = derive(); if (c.plan && c.plan.date === d.today) ensurePlan(true, availOn(d.today));
  render(); if (msg !== false) toast(msg || 'Saved. Today\u2019s plan was updated.');
}
export function settingsPrepHTML() {
  const c = core(), P = c.prep, A = c.availability, ex = activeExam();
  const win = w => (w || []).map(x => x.start + '-' + x.end).join(', ');
  const nIn = (k, v, a) => `<input type="number" data-c="prep" data-k="${k}" data-t="num" value="${esc(v)}" ${a || ''}>`;
  const aIn = (k, v, a) => `<input type="number" data-c="avail" data-k="${k}" data-t="num" value="${esc(v)}" ${a || ''}>`;
  const dows = k => `<div class="chips">${DOW.map((n, i) => chip(n, A[k].includes(i), `data-a="avail-dow" data-k="${k}" data-v="${i}"`)).join('')}</div>`;
  const spd = k => `<select data-c="prep" data-k="subjectsPerDay.${k}" data-t="num">${[0, 1, 2, 3, 4, 5, 6].map(x => opt(x, x ? plural(x, 'subject') : 'No limit', P.subjectsPerDay[k])).join('')}</select>`;
  return `<section class="block" id="prep"><h2 style="margin-bottom:10px">Preparation</h2><div class="panel stack">
    ${ex ? `<div><div class="sheet-label">${esc(ex.name)}</div><div class="grid3">
      <label class="f">Description<input type="text" data-c="exam-f" data-id="${ex.id}" data-k="desc" value="${esc(ex.desc || '')}"></label>
      <label class="f">Exam time<input type="time" data-c="exam-f" data-id="${ex.id}" data-k="time" value="${esc(ex.time || '')}"></label>
      <label class="f">Location or centre<input type="text" data-c="exam-f" data-id="${ex.id}" data-k="location" value="${esc(ex.location || '')}"></label>
      <label class="f">Preparation started<input type="date" data-c="exam-f" data-id="${ex.id}" data-k="startDate" value="${esc(ex.startDate || '')}"></label></div>
      <details style="margin-top:10px"${(c.resources || []).some(r => !r.gone && (r.on || []).some(o => o.kind === 'exam' && o.id === ex.id)) ? ' open' : ''}><summary>Exam resources (syllabus, notices, past papers)</summary><div style="margin-top:10px">${resourcesHTML({ kind: 'exam', id: ex.id })}</div></details></div>` : '<p class="small muted">Add an exam above to plan towards it.</p>'}
    <div class="grid3"><label class="f">How you prepare<select data-c="prep" data-k="mode">${opt('self', 'Self study', P.mode)}${opt('lectures', 'Self study with lectures', P.mode)}</select></label>
      <label class="f">Plan effort<select data-c="prep" data-k="effort">${opt('normal', 'Normal', P.effort)}${opt('extra', 'Extra effort', P.effort)}</select></label>
      <label class="f">Extra minutes a study day${nIn('extraMinPerDay', P.extraMinPerDay, 'min="0" max="600" step="5"' + (P.effort === 'extra' ? '' : ' disabled'))}</label></div>
    <div class="hr"></div><div class="sheet-label">Study time</div>
    <div class="grid3"><label class="f">Weekday minutes${aIn('weekday.minutes', A.weekday.minutes, 'min="0" max="1200" step="5"')}</label><label class="f">Weekend minutes${aIn('weekend.minutes', A.weekend.minutes, 'min="0" max="1200" step="5"')}</label>
      <label class="f">Sessions a day (0 = any)${aIn('sessionsPerDay', A.sessionsPerDay, 'min="0" max="12"')}</label>
      <label class="f">Weekday windows<input type="text" data-c="avail-win" data-k="weekday" value="${esc(win(A.weekday.windows))}" placeholder="06:00-08:00, 18:00-21:00"></label>
      <label class="f">Weekend windows<input type="text" data-c="avail-win" data-k="weekend" value="${esc(win(A.weekend.windows))}" placeholder="09:00-12:00"></label>
      <label class="f">Shortest useful session (minutes)${aIn('minSession', A.minSession, 'min="5" max="240"')}</label></div>
    <div class="grid2"><div><div class="sheet-label">Weekend days</div>${dows('weekendDays')}</div><div><div class="sheet-label">Rest days</div>${dows('restDays')}</div></div>
    <div><div class="sheet-label">Dates you cannot study</div><div class="row"><input type="date" id="set-unav" style="width:auto"><button class="btn sm" data-a="avail-unav-add">Add</button></div>
      <div class="chips" style="margin-top:6px">${A.unavailable.map(k => chip(esc(fmtKY(k)) + ' ×', true, `data-a="avail-unav-del" data-v="${k}"`)).join('') || '<span class="tiny muted">None. You can also click dates in Plan, Calendar.</span>'}</div></div>
    <div class="hr"></div><div class="sheet-label">Subjects per day</div>
    <div class="grid3"><label class="f">Weekdays${spd('weekday')}</label><label class="f">Weekends${spd('weekend')}</label>
      <label class="f">Most subject switches a day<select data-c="prep" data-k="maxSwitches" data-t="num">${[0, 1, 2, 3, 4, 5].map(x => opt(x, x ? String(x) : 'No limit', P.maxSwitches)).join('')}</select></label></div>
    <details><summary>Planning assumptions</summary><div class="grid3" style="margin-top:10px">
      <label class="f">Self-study minutes per lecture minute${nIn('selfStudyRatio', P.selfStudyRatio, 'min="0" max="3" step="0.1"')}</label>
      <label class="f">Default lecture length (min)${nIn('defaultLectureMin', P.defaultLectureMin, 'min="5" max="600"')}</label>
      <label class="f">Minutes to learn a new concept${nIn('minPerNewConcept', P.minPerNewConcept, 'min="5" max="600"')}</label>
      <label class="f">Practice minutes per concept${nIn('practiceMinPerConcept', P.practiceMinPerConcept, 'min="0" max="600"')}</label>
      <label class="f">Minutes to re-solve a saved question${nIn('minPerQuestion', P.minPerQuestion, 'min="1" max="120"')}</label>
      <label class="f">Hours for a subject with no structure${nIn('defaultSubjectHours', P.defaultSubjectHours, 'min="1" max="2000"')}</label>
      <label class="f">Practice target<select data-c="prep" data-k="practiceScale" data-t="num">${[[1, 'Full'], [0.8, '80%'], [0.6, '60%']].map(x => opt(x[0], x[1], P.practiceScale)).join('')}</select></label></div>
      <label class="check" style="margin-top:10px"><input type="checkbox" data-c="prep" data-k="dropLowImportance"${P.dropLowImportance ? ' checked' : ''}> Leave low-importance subjects out of the workload estimate</label>
      <label class="check"><input type="checkbox" data-c="prep" data-k="acceptIncomplete"${P.acceptIncomplete ? ' checked' : ''}> Keep the schedule even if not everything fits (the shortfall stays visible)</label></details>
    <div class="row"><button class="btn sm" data-a="import-open">Import syllabus</button><a class="btn sm" href="#lectures">Lectures</a><button class="btn sm" data-a="prep-new">Start a new preparation</button></div>
  </div></section>`;
}

/* ================================================================== syllabus import */

function importTree(M) {
  const f = M.f, text = String(f.text || '');
  if (!text.trim()) return { tree: null, err: '' };
  try {
    const isJson = /^\s*[[{]/.test(text), into = f.into && N(f.into) ? N(f.into).name : '';
    const src = !isJson && into ? into + '\n' + text.split('\n').map(x => '  ' + x).join('\n') : text;
    return { tree: parseSyllabus(src), err: '' };
  } catch (e) { return { tree: null, err: e.message }; }
}
function importModal() {
  const M = ui.modal, f = M.f, subs = examSubjects(false), { tree, err } = importTree(M);
  const pv = tree ? previewImport(tree, core().nodes) : null;
  return { wide: true, html: `<div class="mhead"><div><h2>Import syllabus</h2><p class="small muted">Paste an outline or JSON, or load a file. Existing subjects, topics and concepts with the same name are reused, never duplicated.</p></div><button class="x" data-a="close" aria-label="Close">×</button></div>
    <div class="grid2"><label class="f">Put everything under<select data-c="syl-into">${opt('', 'Subjects named in the text', f.into)}${subs.map(s => opt(s.id, s.name, f.into)).join('')}</select></label>
      <label class="f">Or load a file<input type="file" accept=".json,.txt,.md,text/plain,application/json" data-c="syl-file"></label></div>
    <textarea data-c="syl-text" rows="12" placeholder="Mechanics&#10;  Kinematics&#10;    Projectile motion&#10;  Newton's laws&#10;Thermodynamics&#10;  First law">${esc(f.text)}</textarea>
    <p class="tiny muted">Outline: a line with no indent is a subject, indented lines are topics, deeper lines are concepts (or subtopics with concepts under them). Markdown headings and bullets work. JSON: <code>{"subjects":[{"subject":"Name","topics":[{"topic":"Name","concepts":["A","B"]}]}]}</code></p>
    <div id="syl-preview">${err ? `<div class="note red small">${esc(err)}</div>` : pv ? `<div class="panel tight"><div class="small"><b>Will add</b> ${plural(pv.totals.subjects, 'subject')}, ${plural(pv.totals.topics, 'topic')}, ${plural(pv.totals.subtopics, 'subtopic')} and ${plural(pv.totals.concepts, 'concept')}${pv.totals.skipped ? `; ${pv.totals.skipped} already exist` : ''}.</div>
      <div class="list">${pv.subjects.map(s => `<div class="li"><div class="grow"><div class="title">${esc(s.name)} ${s.existing ? '<span class="tag">Existing</span>' : '<span class="tag blue">New</span>'}</div><div class="sub">${plural(s.topics, 'topic')}, ${plural(s.subtopics, 'subtopic')}, ${plural(s.concepts, 'concept')}${s.skipped ? `, ${s.skipped} already there` : ''}</div></div></div>`).join('')}</div>
      ${pv.warnings.length ? `<ul class="tiny muted">${pv.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>` : ''}</div>
    <div class="actions"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="syl-import"${pv && (pv.totals.subjects + pv.totals.topics + pv.totals.subtopics + pv.totals.concepts) ? '' : ' disabled'}>Import</button></div>` };
}
function refreshImportPreview() {
  const box = document.getElementById('syl-preview'); if (!box || !ui.modal) return;
  const tmp = document.createElement('div'); tmp.innerHTML = importModal().html;
  const n = tmp.querySelector('#syl-preview'); if (n) box.innerHTML = n.innerHTML;
  const b = document.querySelector('[data-a="syl-import"]'), nb = tmp.querySelector('[data-a="syl-import"]'); if (b && nb) b.disabled = nb.disabled;
}

/* ================================================================== actions */

export const ACT = {
  // storage
  'storage-open': () => { ui.modal = { type: 'storage' }; renderModal(); },
  'banner-off': () => { ui.bannerOff = derive().today; renderMain(); },
  'fs-save': () => { if (!FS.status().fileName) { createFile(); return; } FS.saveNow().then(() => { setSaveStatus(); if (FS.status().state === 'saved') toast('Saved to ' + FS.status().fileName + '.'); if (ui.modal && ui.modal.type === 'storage') renderModal(); }); },
  'fs-reconnect': () => { FS.reconnect().then(ok => { setSaveStatus(); toast(ok ? 'Reconnected. Saving to ' + FS.status().fileName + ' again.' : 'Still not allowed. Your changes stay in this browser.'); render(); }).catch(e => toast(e.message)); },
  'fs-create': () => createFile(),
  'fs-open': () => openFile(),
  'welcome-open': () => openFile(),
  'fs-export': () => exportCopy(),
  'fs-forget': () => askConfirm({ title: 'Stop saving to this file?', text: 'The file stays on your computer as it is now. Your preparation stays in this browser until you save it to a file again.', yes: 'Stop using it', fn: async () => { await FS.forget(); render(); } }),
  'open-go': () => {
    const r = ui.modal && ui.modal.r; if (!r) return; ui.modal = null; renderModal();
    FS.commitOpen(r).then(() => { setSaveStatus(); ensurePlan(true); go('today'); toast(r.empty ? 'Linked ' + r.name + '. Your progress is saved there from now on.' : r.handle ? 'Linked ' + (r.name || 'the progress file') + '. Changes are saved to it.' : 'Opened ' + (r.name || 'the copy') + '.'); })
      .catch(e => { console.error(e); toast('Could not open it: ' + (e && e.message)); });
  },
  'prep-new': () => {
    const d = derive(), has = d.subjects.length || d.sessions.length;
    const f = FS.status();
    if (!has) { startNewPreparation(); return; }
    askConfirm({ title: 'Start a new preparation?', text: f.fileName ? `The current one stays in ${esc(f.fileName)}. Open that file any time to switch back.` : 'The current one is only in this browser. Save it to a file or download a copy first if you want to keep it; a recovery copy is also kept in this browser.', yes: 'Start new', fn: () => startNewPreparation() });
  },
  // today
  'recovery-off': () => { ui.recoveryOff = derive().today; renderMain(); },
  'task-skip': el => { const b = planTask(el.dataset.k); if (!b) return; const p = core().plan; b.status = 'skipped'; if (p.done) delete p.done[b.key]; if (ui.modal && ui.modal.type === 'task') ui.modal = null; commitPlanEdit('Skipped. It will not be carried over; its work comes back in later plans.'); },
  'task-unskip': el => { const b = planTask(el.dataset.k); if (!b) return; b.status = 'todo'; commitPlanEdit(); },
  'task-edit': el => { const b = planTask(el.dataset.k); if (!b) return; ui.modal = { type: 'task', key: b.key, startWas: b.locked && b.start ? b.start : '', f: { title: b.title, min: b.min, start: b.locked && b.start ? b.start : '', sid: b.subjectId || '', locked: !!b.locked } }; renderModal(); },
  'task-save': () => {
    const M = ui.modal, b = planTask(M.key), f = M.f; if (!b) { closeModal(); return; }
    const min = Math.max(5, Math.min(600, Math.round(+f.min || b.min)));
    b.title = String(f.title || '').trim() || b.title; b.min = min; b.manual = true; b.locked = !!f.locked;
    if (f.start && isClock(f.start)) { b.start = f.start; b.end = minToClock(Math.min(24 * 60 - 1, clockToMin(f.start) + min)); b.locked = true; }
    else if (!f.start && M.startWas) { b.start = null; b.end = null; }
    if (ONE_SUBJECT_KINDS.has(b.kind) && (f.sid || '') !== (b.subjectId || '')) {
      b.subjectId = f.sid || null; const d = derive();
      if (f.sid) { b.cids = b.cids.filter(cid => d.subjOf[cid] === f.sid); if (b.lectureId && (d.lectures.find(l => l.id === b.lectureId) || {}).subjectId !== f.sid) b.lectureId = null; }
      (b.why = b.why || []).unshift('subject chosen by you');
    }
    ui.modal = null; commitPlanEdit('Task updated.');
  },
  'task-move': el => {
    const M = ui.modal, b = M && planTask(M.key); if (!b) return;
    const k = el.dataset.v || ($('#task-move-date') || {}).value;
    if (!moveTask(b, k)) return;
    ui.modal = null; commitPlanEdit('Moved to ' + fmtKW(k) + '.');
  },
  'task-del': el => { const p = core().plan; if (!p) return; p.blocks = p.blocks.filter(x => x.key !== el.dataset.k); ui.modal = null; commitPlanEdit('Task removed.'); },
  'task-new': () => { ui.modal = { type: 'task-new', f: { kind: 'new', sid: '', title: '', min: 30 } }; renderModal(); },
  'task-add': () => {
    const f = ui.modal.f, p = ensurePlan(false), min = Math.max(5, Math.min(600, Math.round(+f.min || 30)));
    const title = String(f.title || '').trim() || (KIND_NAME[f.kind] || 'Study') + (f.sid ? ': ' + subjName(f.sid) : '');
    p.blocks.push({ key: 'm' + uid('').slice(-7), id: uid('tk'), kind: f.kind, min, title, cids: [], mids: [], subjectId: f.sid || null, status: 'todo', manual: true, added: true, why: ['added by you'] });
    ui.modal = null; commitPlanEdit('Added to today.');
  },
  'dayplan-del': el => { const c = core(), dp = c.dayPlans[el.dataset.k]; if (!dp) return; dp.blocks = dp.blocks.filter(x => x.key !== el.dataset.v); if (!dp.blocks.length) delete c.dayPlans[el.dataset.k]; Store.touch('core'); renderMain(); },
  // plan
  'plan-tab': el => { ui.planTab = el.dataset.v; if (ui.view !== 'plan') go('plan'); else renderMain(); },
  'plan-month': el => { const v = +el.dataset.v, d = derive(); if (!v) { ui.planMonth = null; renderMain(); return; } const dt = keyToDate((ui.planMonth || d.today.slice(0, 7)) + '-01'); dt.setMonth(dt.getMonth() + v); ui.planMonth = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); renderMain(); },
  'plan-unav': el => { const A = core().availability, k = el.dataset.k; A.unavailable = A.unavailable.includes(k) ? A.unavailable.filter(x => x !== k) : A.unavailable.concat(k).sort(); prepChanged(A.unavailable.includes(k) ? fmtKW(k) + ' marked as unavailable.' : fmtKW(k) + ' is a study day again.'); },
  'plan-rebase': () => askConfirm({ title: 'Re-plan from today?', text: 'The roadmap as it stands now becomes the baseline that "behind" and "ahead" are measured against. Your data and today\u2019s finished tasks are not changed.', yes: 'Re-plan', fn: () => { rebaseline(); ensurePlan(true); render(); toast('Roadmap re-planned from today.'); } }),
  'feas-effort': el => { const P = core().prep; if (el.dataset.v === 'extra') { P.effort = 'extra'; if (+el.dataset.n) P.extraMinPerDay = +el.dataset.n; } else P.effort = 'normal'; rebaseline(); prepChanged(P.effort === 'extra' ? `Extra effort plan: +${P.extraMinPerDay} min on each study day.` : 'Normal plan.'); },
  'feas-apply': el => {
    const c = core(), P = c.prep, A = c.availability, k = el.dataset.v, n = +el.dataset.n || 0;
    if (k === 'extra-weekend') A.weekend.minutes += n;
    else if (k === 'more-days') A.restDays = [];
    else if (k === 'drop-optional') P.dropLowImportance = true;
    else if (k === 'reduce-practice') P.practiceScale = 0.6;
    else if (k === 'accept') P.acceptIncomplete = true;
    else if (k === 'prioritize') { const subs = c.nodes.filter(x => x.kind === 'subject'); subs.sort((a, b) => ((b.imp || 2) - (a.imp || 2)) || ((b.priority || 2) - (a.priority || 2)) || ((a.order || 0) - (b.order || 0))).forEach((s, i) => { s.order = i; }); }
    rebaseline(); prepChanged(k === 'accept' ? 'Kept as is. The shortfall stays visible on the roadmap.' : 'Applied. The roadmap and today\u2019s plan were updated.');
  },
  'feas-undo': el => { const P = core().prep, v = el.dataset.v; if (v === 'effort') P.effort = 'normal'; if (v === 'drop') P.dropLowImportance = false; if (v === 'practice') P.practiceScale = 1; if (v === 'accept') P.acceptIncomplete = false; rebaseline(); prepChanged(); },
  'week-off': el => { ui.weekOff = Math.max(0, (ui.weekOff || 0) + (+el.dataset.v)); renderMain(); },
  // settings
  'avail-dow': el => { const A = core().availability, k = el.dataset.k, d = +el.dataset.v; A[k] = A[k].includes(d) ? A[k].filter(x => x !== d) : A[k].concat(d).sort(); prepChanged(); },
  'avail-unav-add': () => { const v = ($('#set-unav') || {}).value; if (!isDateKey(v)) { toast('Pick a date first.'); return; } const A = core().availability; if (!A.unavailable.includes(v)) A.unavailable = A.unavailable.concat(v).sort(); prepChanged(); },
  'avail-unav-del': el => { const A = core().availability; A.unavailable = A.unavailable.filter(k => k !== el.dataset.v); prepChanged(); },
  // syllabus import
  'import-open': () => { ui.modal = { type: 'import-syl', f: { text: '', into: ui.view === 'subject' && ui.param ? ui.param : '' } }; renderModal(); },
  'syl-import': () => {
    const M = ui.modal, { tree } = importTree(M); if (!tree) return;
    const c = core(), ex = activeExam();
    const r = applyImport(tree, c.nodes, { examId: ex ? ex.id : null, palette: PALETTE, id: uid });
    c.nodes = r.nodes; Store.touch('core'); invalidate(); ui.modal = null;
    if (c.plan) ensurePlan(true, c.plan.avail);
    render(); toast(`Imported ${plural(r.added.length, 'item')}.`);
  }
};
export const CHG = {
  prep: (el, e) => {
    if (e.type !== 'change') return; const v = typed(el); if (v === null) return;
    const P = core().prep; setPath(P, el.dataset.k, v);
    if (el.dataset.k === 'mode' && v === 'lectures' && !derive().lectures.length) toast('Add lectures per subject on the Lectures page.');
    prepChanged();
  },
  avail: (el, e) => { if (e.type !== 'change') return; const v = typed(el); if (v === null) return; setPath(core().availability, el.dataset.k, Math.max(0, Math.round(v))); prepChanged(); },
  'avail-win': (el, e) => {
    if (e.type !== 'change') return; const r = parseWindows(el.value);
    if (r.errors.length) { toast('Could not read: ' + r.errors.join(', ') + '. Use 24-hour times like 06:00-08:00.'); return; }
    core().availability[el.dataset.k].windows = r.windows; prepChanged();
  },
  'syl-into': (el, e) => { if (e.type !== 'change' || !ui.modal) return; ui.modal.f.into = el.value; renderModal(); },
  'syl-text': el => { if (!ui.modal) return; ui.modal.f.text = el.value; clearTimeout(ui.sylT); ui.sylT = setTimeout(refreshImportPreview, 250); },
  'syl-file': async (el, e) => { if (e.type !== 'change' || !el.files || !el.files[0]) return; const t = await el.files[0].text(); if (!ui.modal) return; ui.modal.f.text = t; renderModal(); }
};
export const MODALS = {
  storage: storageModal,
  'open-confirm': openConfirmModal,
  task: taskModal,
  'task-new': taskNewModal,
  'import-syl': importModal
};
