/*
 * Lectures and practice questions.
 *
 * Lectures: numbered per subject (L01, L02 …) from their position; ids never change, so renaming, inserting and
 * reordering keep every link (sessions, tasks, concepts). A lecture is covered after watching plus self-study or
 * recall, or when you mark it complete.
 * Practice: individual questions with their own spaced schedule (separate from concept memory). Each attempt also
 * feeds the concept's practice accuracy, and a wrong answer becomes a mistake that keeps the question.
 */
import {
  $, esc, plural, pct, uid, sum, dayStart, DAY, Memory, MISTAKE_TYPES, Store, ui, N, core, derive, model,
  questionSubject, conceptsUnder, pathStr, subjColor, subjName, saveQuestion, addQAttempt, removeQuestion, saveMistake, addPractice, memOpts, startSession,
  toast, go, render, renderMain, renderModal, askConfirm, chip, opt, pickerHTML, scaleHTML, relDue, examSubjects, activeExam, openStart, stateTag, beginReview
} from './ui.js';
import { createQuestion, recordAttempt, mistakeFromQuestion, resetMistake, reviewBuckets, reviewOrder, questionStats, questionState, resultToGrade } from '../lib/practice';
import { insertLecture, appendLectures, moveLecture, renameLecture, updateLecture, removeLecture, subjectLectures, markStep, syncAutoConcepts } from '../lib/lectures';
import { fmtH } from '../lib/roadmap';
import { isDateKey } from '../lib/dates';

const DIFF = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const QTYPE = [['mcq', 'Multiple choice'], ['numerical', 'Numerical'], ['short', 'Short answer'], ['descriptive', 'Descriptive'], ['coding', 'Coding'], ['other', 'Other']];
const RES_KINDS = [['lecture', 'Lecture'], ['video', 'Video'], ['youtube', 'YouTube'], ['website', 'Website'], ['book', 'Book'], ['pdf', 'PDF'], ['notes', 'Notes'], ['questionbank', 'Question bank'], ['mock', 'Mock test'], ['other', 'Other']];
const STEP_NAME = { watch: 'Watch', study: 'Self-study', recall: 'Recall', practice: 'Practice' };
const fmtK = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const safeUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';

/* ================================================================== LECTURES */

function lecturesOf(sid) { return subjectLectures(core().lectures || [], sid); }
function saveLectures(list, sid) {
  const c = core(); c.lectures = list;
  if (sid) { const r = syncAutoConcepts(c.nodes, c.lectures, sid, { id: uid }); c.nodes = r.nodes; c.lectures = r.lectures; }
  Store.touch('core');
}
function lecRow(l, n, total) {
  const d = derive(), lab = d.lecLab[l.id] || { code: 'L?', label: l.name }, pg = d.lecProg[l.id];
  const editing = ui.lecRename === l.id;
  const steps = ['watch', 'study', 'recall', 'practice'].map(k => `<button class="step${pg && pg[k] ? ' on' : ''}" data-a="lec-step" data-id="${l.id}" data-v="${k}" aria-pressed="${!!(pg && pg[k])}" title="${STEP_NAME[k]}">${STEP_NAME[k][0]}</button>`).join('');
  const status = !pg ? '' : pg.covered ? '<span class="tag green">Done</span>' : pg.status === 'in-progress' ? `<span class="tag blue">Next: ${esc(STEP_NAME[pg.next] || 'finish')}</span>` : '<span class="tag">To watch</span>';
  return `<div class="li lec-row${pg && pg.covered ? ' done' : ''}">
    <span class="lec-code num">${esc(lab.code)}</span>
    <div class="grow">${editing ? `<div class="row"><input type="text" id="lec-rename" value="${esc(l.name)}" placeholder="${esc(lab.code)} title" data-id="${l.id}" style="max-width:360px"><button class="btn sm primary" data-a="lec-rename-save" data-id="${l.id}">Save</button><button class="btn sm" data-a="lec-rename-cancel">Cancel</button></div>`
      : `<button class="linkbtn title" data-a="lec-open" data-id="${l.id}">${esc(l.name || lab.code)}</button>`}
      <div class="sub">${l.min ? l.min + ' min' : 'Length not set'}${(l.conceptIds || []).length ? ', ' + plural(l.conceptIds.length, 'concept') : ''}${l.url ? ', has link' : ''}</div></div>
    <div class="steps" role="group" aria-label="Steps">${steps}</div>${status}
    <div class="lec-tools">${!editing ? `<button class="iconbtn" data-a="lec-rename" data-id="${l.id}">Rename</button>` : ''}<button class="iconbtn" data-a="lec-start" data-id="${l.id}">Start</button>
      <button class="iconbtn" data-a="lec-move" data-id="${l.id}" data-v="-1" aria-label="Move up"${n ? '' : ' disabled'}>↑</button><button class="iconbtn" data-a="lec-move" data-id="${l.id}" data-v="1" aria-label="Move down"${n < total - 1 ? '' : ' disabled'}>↓</button>
      <button class="iconbtn" data-a="lec-insert" data-id="${l.id}" title="Insert a lecture after this one">Insert after</button></div></div>`;
}
function lectureSummary(sid) {
  const d = derive(), ls = d.lectures.filter(l => l.subjectId === sid);
  if (!ls.length) return null;
  const done = ls.filter(l => d.lecProg[l.id].covered).length, prog = ls.filter(l => d.lecProg[l.id].status === 'in-progress').length;
  const mins = ls.map(l => l.min).filter(Boolean), avg = mins.length ? Math.round(sum(mins) / mins.length) : null;
  const wk = ls.filter(l => d.lecProg[l.id].completedAt && d.lecProg[l.id].completedAt >= d.now - 7 * DAY).length;
  const base = core().roadmap && core().roadmap.lectures ? ls.filter(l => { const k = core().roadmap.lectures[l.id]; return k && k <= d.today; }).length : null;
  return { total: ls.length, done, prog, avg, wk, behind: base == null ? null : base - done, left: sum(ls.filter(l => !d.lecProg[l.id].covered).map(l => l.min || core().prep.defaultLectureMin)) };
}
export function viewLectures() {
  const d = derive(), subs = examSubjects(false);
  const withL = subs.filter(s => d.lectures.some(l => l.subjectId === s.id));
  if (!ui.lecSub || !subs.some(s => s.id === ui.lecSub)) ui.lecSub = (withL[0] || subs[0] || {}).id || null;
  const m = model(), L = m.lec;
  const head = `<div class="page-head"><div><h1>Lectures</h1><p>Each lecture is watched, then studied on your own, then recalled. Codes follow the order, so inserting or moving a lecture renumbers the rest and keeps every title and link.</p></div></div>`;
  if (!subs.length) return head + '<div class="empty">Add subjects first.</div>';
  const overall = L.total ? `<div class="stats">${statBox(L.done + ' / ' + L.total, 'Lectures done')}${statBox(Math.round(L.pct * 100) + '%', 'Complete')}${statBox(L.doneThisWeek, 'Done this week')}${statBox(L.avgMin ? L.avgMin + ' min' : '–', 'Average length')}
      ${statBox(L.projectedEnd ? fmtK(L.projectedEnd) : '–', 'Finish at recent pace')}${statBox(L.remainingMin ? fmtH(L.remainingMin * (1 + core().prep.selfStudyRatio)) : '0', 'Left with self-study')}</div>
    ${L.behindLectures > 0 ? `<div class="note red">${plural(L.behindLectures, 'lecture')} behind the roadmap${L.behindDays ? `, about ${plural(L.behindDays, 'day')}` : ''}. The daily plan keeps lectures in order; the backlog is spread over the coming days.</div>` : L.expectedDone != null && L.total ? '<div class="note green">Lectures are on schedule.</div>' : ''}` : '';
  const s = subs.find(x => x.id === ui.lecSub), ls = s ? lecturesOf(s.id) : [], sm = s ? lectureSummary(s.id) : null;
  return head + overall + `
    <div class="chips" style="margin:14px 0">${subs.map(x => chip(`<span class="dot" style="background:${x.color}"></span> ${esc(x.name)} <span class="muted">${d.lectures.filter(l => l.subjectId === x.id).length || ''}</span>`, x.id === ui.lecSub, `data-a="lec-sub" data-id="${x.id}"`)).join('')}</div>
    ${s ? `<section class="block" style="margin-top:0"><div class="spread"><h2>${esc(s.name)}</h2><span class="small muted">${sm ? `${sm.done} of ${sm.total} done${sm.prog ? ', ' + sm.prog + ' in progress' : ''}${sm.behind > 0 ? `, <b class="bad">${sm.behind} behind</b>` : ''}` : 'No lectures yet'}</span></div>
      ${sm ? `<div class="meter" style="margin:8px 0 12px"><span style="width:${Math.round(sm.done / sm.total * 100)}%;background:${s.color}"></span></div>` : ''}
      <div class="list">${ls.map((l, n) => lecRow(l, n, ls.length)).join('') || '<div class="li muted">No lectures in this subject.</div>'}</div>
      <div class="panel stack" style="margin-top:12px"><div class="row" style="align-items:flex-end"><label class="f" style="max-width:130px">Add lectures<input type="number" min="1" max="500" id="lec-add-n" placeholder="10"></label>
        <label class="f" style="max-width:150px">Minutes each<input type="number" min="5" max="600" id="lec-add-min" value="${esc(sm && sm.avg || core().prep.defaultLectureMin)}"></label><button class="btn" data-a="lec-add" data-id="${s.id}">Add at the end</button>
        ${ls.length ? `<button class="btn" data-a="lec-titles" data-id="${s.id}">Paste titles</button>` : ''}</div>
        <p class="tiny muted">Lectures with titles show as “L05 Continuity”. A lecture with no title just shows its code.</p></div></section>` : ''}`;
}
function statBox(v, l) { return `<div class="stat"><b>${v}</b><span>${l}</span></div>`; }
function lectureModal() {
  const M = ui.modal, l = (core().lectures || []).find(x => x.id === M.id), d = derive();
  if (!l || l.gone) return { html: '<p>This lecture no longer exists.</p><div class="actions"><button class="btn" data-a="close">Close</button></div>' };
  const f = M.f, lab = d.lecLab[l.id] || { code: '' }, pg = d.lecProg[l.id] || {};
  const cs = conceptsUnder(l.subjectId).filter(cn => !cn.archived && !cn.auto);
  const earlier = lecturesOf(l.subjectId).filter(x => x.order < l.order);
  const res = (core().resources || []).filter(r => !r.gone && (r.on || []).some(t => t.kind === 'lecture' && t.id === l.id));
  const stepRow = (k, field, label) => `<label class="check"><input type="checkbox" data-c="fv" data-k="${k}" data-t="bool"${f[k] ? ' checked' : ''}> ${label}${l[field] ? ` <span class="tiny muted">${esc(new Date(l[field]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</span>` : ''}</label>`;
  return { wide: true, html: `<div class="mhead"><div><div class="small muted">${esc(subjName(l.subjectId))}</div><h2>${esc(lab.code)}${l.name ? ' ' + esc(l.name) : ''}</h2></div><button class="x" data-a="close" aria-label="Close">×</button></div>
    <div class="grid2"><label class="f">Title<input type="text" data-c="fv" data-k="name" value="${esc(f.name)}" placeholder="${esc(lab.code)}"></label><label class="f">Length (minutes)<input type="number" min="1" data-c="fv" data-k="min" value="${esc(f.min || '')}"></label></div>
    <div class="grid3"><label class="f">Link (optional)<input type="url" data-c="fv" data-k="url" value="${esc(f.url || '')}" placeholder="https://"></label><label class="f">Instructor (optional)<input type="text" data-c="fv" data-k="instructor" value="${esc(f.instructor || '')}"></label>
      <label class="f">Importance<select data-c="fv" data-k="imp">${[[3, 'High'], [2, 'Medium'], [1, 'Low']].map(x => opt(x[0], x[1], f.imp || 2)).join('')}</select></label></div>
    <div><div class="sheet-label">Progress</div><div class="grid3">${stepRow('watch', 'watchedAt', 'Watched')}${stepRow('study', 'studiedAt', 'Self-study done')}${stepRow('recall', 'recalledAt', 'Recalled')}${stepRow('practice', 'practicedAt', 'Practised')}${stepRow('done', 'doneAt', 'Mark complete')}</div>
      <p class="tiny muted">${pg.covered ? 'Counts as covered.' : 'Counts as covered after watching plus self-study or recall, or when marked complete.'}</p></div>
    ${cs.length ? `<div><div class="sheet-label">Concepts this lecture teaches</div><div class="chips scroll-chips">${cs.map(cn => chip(esc(cn.name), f.cids.includes(cn.id), `data-a="lec-c" data-id="${cn.id}"`)).join('')}</div>
      <p class="tiny muted">Recalling or practising these after the lecture counts as consolidating it.</p></div>` : '<p class="tiny muted">This subject has no topics or concepts of its own, so the lecture itself is used for recall.</p>'}
    ${earlier.length ? `<div><div class="sheet-label">Watch after (prerequisites)</div><div class="chips scroll-chips">${earlier.map(x => chip(esc(d.lecLab[x.id] ? d.lecLab[x.id].label : x.name), f.prereq.includes(x.id), `data-a="lec-pre" data-id="${x.id}"`)).join('')}</div></div>` : ''}
    <label class="f">Notes<textarea data-c="fv" data-k="notes" rows="3">${esc(f.notes || '')}</textarea></label>
    ${resourcesHTML({ kind: 'lecture', id: l.id }, res)}
    <div class="actions"><button class="btn danger left" data-a="lec-del" data-id="${l.id}">Delete lecture</button><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="lec-save">Save</button></div>` };
}

/* ---------- lecture recall (a lecture without concepts of its own) ---------- */
export function openLectureRecall(lid, blockKey) {
  const d = derive(), l = d.lectures.find(x => x.id === lid);
  if (!l) { toast('That lecture no longer exists.'); return; }
  if ((l.conceptIds || []).filter(x => N(x) && !N(x).auto).length) { /* the plan task is a normal review in that case */ }
  ui.modal = { type: 'lrecall', id: lid, blockKey: blockKey || null, f: { text: '' } }; renderModal();
}
function lectureRecallModal() {
  const M = ui.modal, d = derive(), l = d.lectures.find(x => x.id === M.id); if (!l) return null;
  return { html: `<div class="mhead"><div><div class="small muted">Recall</div><h2>${esc(d.lecLab[l.id].label)}</h2></div><button class="x" data-a="close" aria-label="Close">×</button></div>
    <p>Without looking at your notes, write down what the lecture covered: the main ideas, definitions, formulas, and one example. Then check against your notes.</p>
    <textarea data-c="fv" data-k="text" rows="7" placeholder="What I remember…">${esc(M.f.text || '')}</textarea>
    <p class="small muted">How much did you recall?</p>
    <div class="actions"><button class="btn" data-a="lrec-grade" data-v="1">Little</button><button class="btn" data-a="lrec-grade" data-v="2">Some of it</button><button class="btn primary" data-a="lrec-grade" data-v="3">Most of it</button></div>` };
}

/* ---------- resources (exam, subject, topic, concept or lecture) ---------- */
export function resourcesHTML(target, list) {
  const rs = list || (core().resources || []).filter(r => !r.gone && (r.on || []).some(t => t.kind === target.kind && t.id === target.id));
  return `<div><div class="sheet-label">Resources</div><div class="list">${rs.map(r => { const u = safeUrl(r.url);
    return `<div class="li"><span class="tag">${esc((RES_KINDS.find(k => k[0] === r.kind) || [0, 'Link'])[1])}</span><div class="grow"><div class="title">${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(r.title || u)}</a>` : esc(r.title)}</div>${r.notes ? `<div class="sub">${esc(r.notes)}</div>` : ''}</div>
      <button class="iconbtn" data-a="res2-del" data-id="${r.id}">Remove</button></div>`; }).join('') || '<div class="li muted small">None yet. Links open in your browser; offline, the title and notes are still here.</div>'}</div>
    <div class="row res-add" style="margin-top:8px"><select data-r="kind" style="width:auto" aria-label="Kind">${RES_KINDS.map(k => opt(k[0], k[1], 'video')).join('')}</select><input type="text" data-r="title" placeholder="Title" style="max-width:220px" aria-label="Title"><input type="url" data-r="url" placeholder="Link (optional)" style="max-width:240px" aria-label="Link">
      <button class="btn sm" data-a="res2-add" data-k="${target.kind}" data-id="${target.id}">Add</button></div></div>`;
}

/* ================================================================== PRACTICE QUESTIONS */

function questionsForView() { const d = derive(), subs = new Set(examSubjects(false).map(s => s.id)); return d.questions.filter(q => { const s = questionSubject(q); return !s || subs.has(s); }); }
function buckets() {
  const d = derive(), c = core();
  const strength = cid => { const i = d.cinfo[cid]; return i && i.mastery.value != null ? i.mastery.value : null; };
  return reviewBuckets({ questions: questionsForView(), qmem: c.qmem || {}, attempts: d.qattempts, now: d.now, sh: d.sh, conceptStrength: strength });
}
export function questionsDueCount() { const b = buckets(); return b.dueToday.length + b.overdue.length; }
function qLine(q) {
  const d = derive(), m = (core().qmem || {})[q.id], at = d.qAtt[q.id] || [], last = at[at.length - 1];
  const sid = questionSubject(q), st = questionState(m, at);
  const stName = { new: 'Not attempted', learning: 'Learning', review: 'In review', stable: 'Stable', struggling: 'Struggling' }[st] || st;
  return `<div class="li clickable" data-a="q-open" data-id="${q.id}"><span class="dot" style="background:${sid ? subjColor(sid) : 'var(--faint)'}"></span>
    <div class="grow"><div class="title qtext">${esc(q.text.length > 140 ? q.text.slice(0, 140) + '…' : q.text)}</div>
      <div class="sub">${esc(q.conceptId && N(q.conceptId) ? pathStr(q.conceptId, 0) : sid ? subjName(sid) : 'Not linked')}${q.source ? ', ' + esc(q.source) + (q.ref ? ' ' + esc(q.ref) : '') : ''}</div></div>
    <span class="tag${st === 'struggling' ? ' red' : st === 'stable' ? ' green' : ''}">${stName}</span>
    <span class="small muted" style="min-width:110px;text-align:right">${last ? (last.result === 'correct' ? 'Right' : last.result === 'partial' ? 'Partly' : 'Wrong') + ', ' : ''}${m && m.due ? relDue(m.due) : 'not scheduled'}</span></div>`;
}
export function viewPractice() {
  if (ui.qrev) return questionReviewCard();
  const d = derive(), tab = ui.pracTab || 'review', qs = questionsForView();
  const head = `<div class="page-head"><div><h1>Practice</h1><p>Log the questions you solve. Each one gets its own revision schedule, and wrong answers come back as mistakes until you can solve them reliably.</p></div>
    <div class="row"><button class="btn primary" data-a="q-new">Log a question</button></div></div>
    <div class="tabs">${[['review', 'Question review'], ['bank', 'All questions'], ['concepts', 'By concept']].map(([k, l]) => `<button aria-selected="${tab === k}" data-a="prac-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (tab === 'bank') {
    const f = ui.qf || (ui.qf = { sid: '', st: '', text: '' });
    const subs = examSubjects(false), rx = f.text.trim().toLowerCase();
    const list = qs.filter(q => (!f.sid || questionSubject(q) === f.sid) && (!f.st || questionState((core().qmem || {})[q.id], d.qAtt[q.id] || []) === f.st) && (!rx || (q.text + ' ' + (q.source || '') + ' ' + (q.tags || []).join(' ')).toLowerCase().includes(rx))).slice().reverse();
    return head + `<div class="row" style="margin:12px 0"><select data-c="qfilter" data-k="sid" style="width:auto">${opt('', 'All subjects', f.sid)}${subs.map(s => opt(s.id, s.name, f.sid)).join('')}</select>
      <select data-c="qfilter" data-k="st" style="width:auto">${opt('', 'Any state', f.st)}${[['new', 'Not attempted'], ['learning', 'Learning'], ['review', 'In review'], ['stable', 'Stable'], ['struggling', 'Struggling']].map(x => opt(x[0], x[1], f.st)).join('')}</select>
      <input type="search" data-c="qsearch" value="${esc(f.text)}" placeholder="Search questions, sources, tags" style="max-width:280px"></div>
      <div class="list" id="qbank">${list.slice(0, 300).map(qLine).join('') || '<div class="li muted">No questions match.</div>'}</div>${list.length > 300 ? `<p class="tiny muted">Showing 300 of ${list.length}. Narrow the filter to see more.</p>` : ''}`;
  }
  if (tab === 'concepts') {
    const by = {}; d.qattempts.forEach(a => { const q = d.qById[a.qid]; if (!q || !q.conceptId) return; const x = by[q.conceptId] || (by[q.conceptId] = { n: 0, c: 0, q: new Set() }); x.n++; x.c += a.result === 'correct' ? 1 : a.result === 'partial' ? 0.5 : 0; x.q.add(a.qid); });
    const rows = Object.entries(by).filter(([cid]) => N(cid)).sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n).map(([cid, x]) => { const i = d.cinfo[cid];
      return `<div class="li clickable" data-a="concept" data-id="${cid}" data-tab="practice"><div class="grow"><div class="title">${esc(N(cid).name)}</div><div class="sub">${esc(pathStr(cid, 0))}</div></div>
        ${i ? stateTag(i.state) : ''}<span class="small">${plural(x.q.size, 'question')}, ${x.n} attempts</span><b class="num" style="min-width:56px;text-align:right">${pct(x.c / x.n)}</b></div>`; });
    return head + `<p class="small muted" style="margin:12px 0">Accuracy on logged questions per concept, weakest first. Understanding a concept (recall) and applying it (practice) are tracked separately; a gap between them shows up here.</p>
      <div class="list">${rows.join('') || '<div class="li muted">Log questions linked to concepts to see this.</div>'}</div>`;
  }
  const b = buckets(), due = [...new Set(b.overdue.concat(b.dueToday))];
  const card = (ids, title, desc, act, tone) => `<div class="qb-card${tone ? ' ' + tone : ''}"><div class="num qb-n">${ids.length}</div><div class="grow"><div class="title">${title}</div><div class="small muted">${desc}</div></div>
    ${ids.length ? `<button class="btn sm" data-a="qrev-start" data-v="${act}">Review</button>` : ''}</div>`;
  ui.qbuckets = b;
  return head + `<div class="qb-grid">
    ${card(due, 'Due now', b.overdue.length ? `${b.overdue.length} overdue` : 'Scheduled for today', 'due', due.length ? 'hot' : '')}
    ${card(b.recentlyWrong, 'Recently wrong', 'Wrong in the last 7 days', 'recentlyWrong', b.recentlyWrong.length ? 'hot' : '')}
    ${card(b.frequentlyFailed, 'Frequently failed', 'Wrong two or more times', 'frequentlyFailed')}
    ${card(b.lowConfidence, 'Low confidence', 'Right, but you were unsure', 'lowConfidence')}
    ${card(b.notRecent, 'Not seen for 14 days', 'Worth a check before they fade', 'notRecent')}
  </div>
  ${b.strongConceptWeakQuestions.length ? `<section class="block"><h2 style="margin-bottom:8px">Strong concept, weak questions</h2><p class="small muted">You recall these concepts well but miss questions on them. More varied practice helps more than more reading.</p>
    <div class="list">${b.strongConceptWeakQuestions.map(x => `<div class="li"><div class="grow"><div class="title">${esc(N(x.cid) ? N(x.cid).name : 'Concept')}</div><div class="sub">${pct(x.accuracy)} on ${x.n} attempts</div></div><button class="btn sm" data-a="qrev-ids" data-v="${x.qids.join(',')}">Review ${plural(x.qids.length, 'question')}</button></div>`).join('')}</div></section>` : ''}
  <section class="block"><div class="spread"><h2>Recently logged</h2><button class="linkbtn" data-a="prac-tab" data-v="bank">All ${qs.length}</button></div>
    <div class="list">${qs.slice(-8).reverse().map(qLine).join('') || '<div class="li muted">No questions yet. Log the ones you get wrong or want to see again; a count in the session summary is enough for the rest.</div>'}</div></section>`;
}

/* ---------- logging and editing questions ---------- */
export function openQuestion(pre) {
  const d = derive(), cid = pre && pre.conceptId;
  const f = { examId: (activeExam() || {}).id || '', subjectId: (pre && pre.subjectId) || (cid ? d.subjOf[cid] : '') || '', topicId: cid ? d.topicOf[cid] || '' : '', subtopicId: cid ? d.subtopicOf[cid] || '' : '', conceptIds: cid ? [cid] : [],
    text: '', source: '', ref: '', difficulty: 'medium', type: 'other', result: '', time: '', conf: null, date: d.today, answer: '', solution: '', notes: '', url: '', image: '', tags: '', mtype: 'concept', why: '', sessionId: (pre && pre.sessionId) || null };
  ui.modal = { type: 'question', f }; renderModal();
}
function editQuestion(qid) {
  const d = derive(), q = d.qById[qid]; if (!q) return;
  const cid = q.conceptId;
  ui.modal = { type: 'question', id: qid, f: { examId: (activeExam() || {}).id || '', subjectId: questionSubject(q) || '', topicId: q.topicId || (cid ? d.topicOf[cid] || '' : ''), subtopicId: q.subtopicId || (cid ? d.subtopicOf[cid] || '' : ''), conceptIds: cid ? [cid] : [],
    text: q.text, source: q.source || '', ref: q.ref || '', difficulty: q.difficulty || 'medium', type: q.type || 'other', answer: q.answer || '', solution: q.solution || '', notes: q.notes || '', url: q.url || '', image: q.image || '', tags: (q.tags || []).join(', ') } };
  renderModal();
}
function questionModal() {
  const M = ui.modal, f = M.f, d = derive(), q = M.id && d.qById[M.id];
  const at = q ? (d.qAtt[q.id] || []) : [], st = q ? questionStats(at) : null, m = q && (core().qmem || {})[q.id];
  return { wide: true, html: `<div class="mhead"><h2>${q ? 'Question' : 'Log a question'}</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
    <label class="f">Question<textarea data-c="fv" data-k="text" rows="3" placeholder="Paste or type the question">${esc(f.text)}</textarea></label>
    ${pickerHTML(f, { single: true })}
    <div class="grid3"><label class="f">Source<input type="text" data-c="fv" data-k="source" value="${esc(f.source)}" placeholder="Book, paper, test series"></label><label class="f">Question number or page<input type="text" data-c="fv" data-k="ref" value="${esc(f.ref)}"></label>
      <label class="f">Difficulty<select data-c="fv" data-k="difficulty">${DIFF.map(x => opt(x[0], x[1], f.difficulty)).join('')}</select></label></div>
    ${q ? '' : `<div><div class="sheet-label">How did it go?</div><div class="chips">${[['correct', 'Correct'], ['partial', 'Partly correct'], ['incorrect', 'Incorrect'], ['', 'Not attempted yet']].map(([k, l]) => chip(l, f.result === k, `data-a="fset" data-k="result" data-v="${k}"`)).join('')}</div></div>
    ${f.result ? `<div class="grid3"><label class="f">Time taken (minutes)<input type="number" min="0" step="0.5" data-c="fv" data-k="time" value="${esc(f.time)}"></label><label class="f">Date practised<input type="date" data-c="fv" data-k="date" value="${esc(f.date)}" max="${d.today}"></label>
      <div><div class="sheet-label">Confidence</div>${scaleHTML('conf', f.conf)}</div></div>` : ''}
    ${f.result === 'incorrect' ? `<div class="panel tight stack"><div class="sheet-label">It becomes a mistake to retry tomorrow, then after 3, 7 and 21 days</div><div class="chips">${MISTAKE_TYPES.map(([k, l]) => chip(l, f.mtype === k, `data-a="fset" data-k="mtype" data-v="${k}"`)).join('')}</div>
      <label class="f">Why it went wrong (optional)<input type="text" data-c="fv" data-k="why" value="${esc(f.why)}"></label></div>` : ''}`}
    <details${q || f.answer || f.solution ? ' open' : ''}><summary class="small">Answer, solution and notes</summary><div class="stack" style="margin-top:10px">
      <div class="grid2"><label class="f">Correct answer<textarea data-c="fv" data-k="answer" rows="2">${esc(f.answer)}</textarea></label><label class="f">Solution or method<textarea data-c="fv" data-k="solution" rows="2">${esc(f.solution)}</textarea></label></div>
      <div class="grid3"><label class="f">Type<select data-c="fv" data-k="type">${QTYPE.map(x => opt(x[0], x[1], f.type)).join('')}</select></label><label class="f">Link (optional)<input type="url" data-c="fv" data-k="url" value="${esc(f.url)}"></label><label class="f">Image or page reference<input type="text" data-c="fv" data-k="image" value="${esc(f.image)}" placeholder="file name or page"></label></div>
      <div class="grid2"><label class="f">Notes<input type="text" data-c="fv" data-k="notes" value="${esc(f.notes)}"></label><label class="f">Tags, comma separated<input type="text" data-c="fv" data-k="tags" value="${esc(f.tags)}" placeholder="previous paper, formula"></label></div></div></details>
    ${q ? `<div class="panel tight"><div class="small">${at.length ? `${plural(at.length, 'attempt')}: ${st.correct} right, ${st.partial} partly, ${st.incorrect} wrong.` : 'Not attempted yet.'} ${m && m.due ? 'Next review ' + relDue(m.due) + '.' : ''}</div>
      ${at.length ? `<div class="tiny muted" style="margin-top:4px">${at.slice(-8).reverse().map(a => `${new Date(a.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${a.result === 'correct' ? 'right' : a.result === 'partial' ? 'partly' : 'wrong'}`).join(', ')}</div>` : ''}</div>` : ''}
    <div class="actions">${q ? `<button class="btn danger left" data-a="q-del" data-id="${q.id}">Delete</button><button class="btn" data-a="qrev-ids" data-v="${q.id}">Re-solve now</button>` : '<button class="btn left" data-a="q-save" data-v="more">Save and log another</button>'}
      <button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="q-save">Save</button></div>` };
}
function saveQuestionForm(again) {
  const M = ui.modal, f = M.f, d = derive();
  if (!f.text.trim()) { toast('Type the question first.'); return; }
  const cid = f.conceptIds[0] || null, sid = f.subjectId || (cid ? d.subjOf[cid] : null) || null;
  const fields = { text: f.text, subjectId: sid, topicId: f.topicId || null, subtopicId: f.subtopicId || null, conceptId: cid, source: f.source, ref: f.ref, difficulty: f.difficulty, type: f.type,
    answer: f.answer, solution: f.solution, notes: f.notes, url: safeUrl(f.url) || '', image: f.image, tags: f.tags.split(',').map(x => x.trim()).filter(Boolean) };
  if (M.id) { const q = d.qById[M.id]; Object.assign(q, createQuestion(Object.assign({}, q, fields), { id: () => q.id, now: q.createdAt })); q.id = M.id; saveQuestion(q); toast('Question saved.'); ui.modal = null; render(); return; }
  const at = f.date && isDateKey(f.date) && f.date !== d.today ? dayStart(f.date, d.sh) + 12 * 3600e3 : Date.now();
  const q = createQuestion(fields, { id: uid, now: at });
  saveQuestion(q);
  if (f.result) recordQuestionResult(q.id, f.result, { timeSec: f.time ? Math.round(+f.time * 60) : null, confidence: f.conf, at, mtype: f.mtype, why: f.why, mode: 'practice', sessionId: f.sessionId, q });
  toast(f.result === 'incorrect' ? 'Saved. It comes back tomorrow as a mistake to retry.' : f.result ? 'Saved. Next review ' + relDue(((core().qmem || {})[q.id] || {}).due || Date.now()) + '.' : 'Saved to your question bank.');
  if (again) { const keep = { examId: f.examId, subjectId: f.subjectId, topicId: f.topicId, subtopicId: f.subtopicId, conceptIds: f.conceptIds.slice(), source: f.source, difficulty: f.difficulty, date: f.date };
    openQuestion({}); Object.assign(ui.modal.f, keep); renderModal(); }
  else { ui.modal = null; render(); }
}
/** One attempt at a saved question: question memory, the concept's practice record, and the mistake it creates or resets. */
export function recordQuestionResult(qid, result, o) {
  o = o || {};
  const d = derive(), c = core(), q = o.q || d.qById[qid]; if (!q) return null;
  const open = d.mistakes.find(m => m.qid === qid && !m.resolved) || null;
  const cid = q.conceptId && N(q.conceptId) ? q.conceptId : null;
  const out = recordAttempt({ question: q, mem: (c.qmem || {})[qid] || null, result, timeSec: o.timeSec ?? null, confidence: o.confidence ?? null, mode: o.fromMistake ? 'retry' : o.mode || 'review',
    sessionId: o.sessionId || (c.active || {}).id || null, openMistake: o.fromMistake ? null : open, now: o.at || Date.now(), memOpts: Object.assign(memOpts(cid || ''), { fuzz: true }), id: uid, answer: o.answer || '' });
  c.qmem = c.qmem || {}; c.qmem[qid] = out.mem; Store.touch('core');
  addQAttempt(out.attempt);
  if (out.practice && cid) addPractice(out.practice);
  if (!o.fromMistake) {
    if (out.mistake === 'create') saveMistake(mistakeFromQuestion(q, { type: o.mtype || 'concept', why: o.why || '' }, { now: o.at || Date.now(), sh: d.sh, id: uid }));
    else if (out.mistake === 'reset' && open) saveMistake(resetMistake(open, Date.now(), d.sh));
  }
  return out;
}
export function mistakeQuestionHTML(x) {
  const q = x.qid && derive().qById[x.qid]; if (!q) return '';
  return `${q.answer && q.answer !== x.fix ? `<div class="answer"><b>Answer:</b> ${esc(q.answer)}</div>` : ''}${q.notes ? `<p class="small muted">${esc(q.notes)}</p>` : ''}${safeUrl(q.url) ? `<p class="small"><a href="${esc(safeUrl(q.url))}" target="_blank" rel="noopener noreferrer">Open the question's link</a></p>` : ''}
    <p class="tiny muted">From your question bank${q.source ? ' (' + esc(q.source) + (q.ref ? ' ' + esc(q.ref) : '') + ')' : ''}. Retrying it also updates its review schedule.</p>`;
}
export function conceptQuestionsHTML(cid) {
  const d = derive(), qs = d.questions.filter(q => q.conceptId === cid);
  return `<div class="spread" style="margin-bottom:8px"><span class="sheet-label" style="margin:0">Saved questions (${qs.length})</span><button class="btn sm" data-a="q-new" data-cid="${cid}">Log a question</button></div>
    ${qs.length ? `<div class="list" style="margin-bottom:14px">${qs.slice(-6).reverse().map(qLine).join('')}</div>` : ''}`;
}
export function subjectQuestionsHTML(sid) {
  const d = derive(), qs = d.questions.filter(q => questionSubject(q) === sid);
  const at = d.qattempts.filter(a => qs.some(q => q.id === a.qid)), st = questionStats(at);
  return `<div class="row" style="margin-bottom:10px"><span class="small">${plural(qs.length, 'question')}${at.length ? `, ${pct((st.correct + st.partial * 0.5) / at.length)} on ${plural(at.length, 'attempt')}` : ''}</span><button class="btn sm" data-a="q-new" data-sid="${sid}">Log a question</button></div>
    <div class="list">${qs.slice().reverse().slice(0, 50).map(qLine).join('') || '<div class="li muted">No questions logged for this subject.</div>'}</div>`;
}
export function subjectLecturesHTML(sid) {
  const ls = lecturesOf(sid), sm = lectureSummary(sid);
  return `${sm ? `<p class="small">${sm.done} of ${sm.total} done${sm.behind > 0 ? `, <b class="bad">${sm.behind} behind the roadmap</b>` : ''}. About ${fmtH(sm.left)} of lectures left.</p>` : ''}
    <div class="list">${ls.slice(0, 200).map((l, n) => lecRow(l, n, ls.length)).join('') || '<div class="li muted">No lectures in this subject.</div>'}</div>
    <div style="margin-top:10px"><button class="btn sm" data-a="lec-goto" data-id="${sid}">Manage lectures</button></div>`;
}

/* ---------- the question review card ---------- */
export function beginQuestionReview(qids, o) {
  const d = derive(), valid = qids.filter(id => d.qById[id]);
  const order = reviewOrder(valid, { questions: d.qById, qmem: core().qmem || {}, recentlyWrong: new Set((ui.qbuckets || buckets()).recentlyWrong) });
  ui.qrev = { queue: order, i: 0, shown: false, pending: null, f: { answer: '', conf: null, mtype: 'concept' }, results: [], fromPlan: (o && o.fromPlan) || null, shownAt: Date.now() };
}
function questionReviewCard() {
  const R = ui.qrev, d = derive();
  if (R.i >= R.queue.length) {
    const n = R.results.length, ok = R.results.filter(r => r === 'correct').length, part = R.results.filter(r => r === 'partial').length;
    return `<div class="page-head"><div><h1>Question review done</h1><p>${plural(n, 'question')}: ${ok} right, ${part} partly, ${n - ok - part} wrong. Wrong ones come back tomorrow as mistakes.</p></div></div>
      <div class="row"><button class="btn primary" data-a="qrev-close">Back to practice</button><button class="btn" data-a="nav" data-v="today">Today's plan</button></div>`;
  }
  const q = d.qById[R.queue[R.i]];
  if (!q) { R.i++; return questionReviewCard(); }
  const sid = questionSubject(q), m = (core().qmem || {})[q.id], at = d.qAtt[q.id] || [];
  const prev = r => { const g = resultToGrade(r, { confidence: R.f.conf }); const res = Memory.apply(m && m.S ? m : null, g, Date.now(), Object.assign(memOpts(q.conceptId || ''), { fuzz: false })); return res.ivl < 1 ? 'today' : plural(Math.round(res.ivl), 'day'); };
  return `<div class="qrev">
    <div class="spread"><span class="small muted">Question ${R.i + 1} of ${R.queue.length}</span><button class="btn sm" data-a="qrev-close">End review</button></div>
    <div class="card qcard"><div class="small muted">${esc(q.conceptId && N(q.conceptId) ? pathStr(q.conceptId, 0) : sid ? subjName(sid) : '')}${q.source ? `, ${esc(q.source)}${q.ref ? ' ' + esc(q.ref) : ''}` : ''}${q.difficulty ? ', ' + esc(q.difficulty) : ''}${at.length ? `, ${plural(at.length, 'earlier attempt')}` : ''}</div>
      <div class="prompt qtext">${esc(q.text)}</div>
      ${safeUrl(q.url) ? `<p class="small"><a href="${esc(safeUrl(q.url))}" target="_blank" rel="noopener noreferrer">Open link</a></p>` : ''}${q.image ? `<p class="tiny muted">See: ${esc(q.image)}</p>` : ''}
      ${!R.shown ? `<label class="f">Your answer or working (optional)<textarea data-c="qrev-f" data-k="answer" rows="3">${esc(R.f.answer)}</textarea></label>
        <div class="row"><span class="small muted">Confidence</span>${scaleHTML('conf', R.f.conf, 'qrev-conf')}</div>
        <div class="actions"><button class="btn primary" data-a="qrev-reveal">Show answer</button></div>`
      : `${q.answer ? `<div class="answer"><b>Answer:</b> ${esc(q.answer)}</div>` : '<p class="small muted">No answer saved for this question. Check it against your source.</p>'}${q.solution ? `<div class="note"><b>Method:</b> ${esc(q.solution)}</div>` : ''}${q.notes ? `<p class="small">${esc(q.notes)}</p>` : ''}
        ${R.pending === 'incorrect' ? `<div class="stack"><div class="sheet-label">What went wrong?</div><div class="chips">${MISTAKE_TYPES.map(([k, l]) => chip(l, R.f.mtype === k, `data-a="qrev-mtype" data-v="${k}"`)).join('')}</div>
          <div class="actions"><button class="btn" data-a="qrev-undo">Back</button><button class="btn primary" data-a="qrev-save" data-v="incorrect">Save and continue</button></div></div>`
        : `<div class="grades"><button class="btn" data-a="qrev-grade" data-v="incorrect">Wrong<small>again ${prev('incorrect')}</small></button><button class="btn" data-a="qrev-grade" data-v="partial">Partly right<small>${prev('partial')}</small></button><button class="btn primary" data-a="qrev-grade" data-v="correct">Right<small>${prev('correct')}</small></button></div>`}`}
    </div></div>`;
}
function nextQuestion() { const R = ui.qrev; R.i++; R.shown = false; R.pending = null; R.f = { answer: '', conf: null, mtype: 'concept' }; R.shownAt = Date.now(); renderMain(); window.scrollTo(0, 0); }

/* ================================================================== actions */

export const ACT = {
  'lec-sub': el => { ui.lecSub = el.dataset.id; ui.lecRename = null; renderMain(); },
  'lec-goto': el => { ui.lecSub = el.dataset.id; go('lectures'); },
  'lec-rename': el => { ui.lecRename = el.dataset.id; renderMain(); const i = $('#lec-rename'); if (i) { i.focus(); i.select(); } },
  'lec-rename-cancel': () => { ui.lecRename = null; renderMain(); },
  'lec-rename-save': el => { const i = $('#lec-rename'); const l = (core().lectures || []).find(x => x.id === el.dataset.id); if (!i || !l) return; saveLectures(renameLecture(core().lectures, l.id, i.value), l.subjectId); ui.lecRename = null; render(); },
  'lec-move': el => { const l = (core().lectures || []).find(x => x.id === el.dataset.id); if (!l) return; saveLectures(moveLecture(core().lectures, l.id, +el.dataset.v), l.subjectId); render(); },
  'lec-insert': el => { const l = (core().lectures || []).find(x => x.id === el.dataset.id); if (!l) return;
    const r = insertLecture(core().lectures, l.subjectId, l.id, { min: l.min }, { id: uid }); saveLectures(r.lectures, l.subjectId); ui.lecRename = r.lecture.id; render(); const i = $('#lec-rename'); if (i) i.focus();
    toast('Inserted ' + derive().lecLab[r.lecture.id].code + '. Later lectures were renumbered.'); },
  'lec-add': el => { const sid = el.dataset.id, n = Math.floor(+($('#lec-add-n') || {}).value || 0), min = Math.floor(+($('#lec-add-min') || {}).value || 0) || core().prep.defaultLectureMin;
    if (n < 1) { toast('How many lectures?'); return; }
    if (core().prep.mode !== 'lectures') core().prep.mode = 'lectures';
    saveLectures(appendLectures(core().lectures || [], sid, Math.min(500, n), { min, id: uid }), sid); render(); toast(plural(n, 'lecture') + ' added.'); },
  'lec-titles': el => { ui.modal = { type: 'lec-titles', sid: el.dataset.id, f: { text: lecturesOf(el.dataset.id).map(l => l.name).join('\n'), start: 1 } }; renderModal(); },
  'lec-titles-save': () => { const M = ui.modal, ls = lecturesOf(M.sid), lines = M.f.text.split('\n'), start = Math.max(1, Math.floor(+M.f.start || 1)) - 1;
    let list = core().lectures; lines.forEach((t, i) => { const l = ls[start + i]; if (l && t.trim() !== (l.name || '')) list = renameLecture(list, l.id, t.trim()); });
    const extra = lines.length - (ls.length - start); if (extra > 0 && lines.slice(ls.length - start).some(x => x.trim())) toast(`${plural(extra, 'title')} had no lecture to go to. Add more lectures first.`);
    saveLectures(list, M.sid); ui.modal = null; render(); },
  'lec-open': el => { const l = (core().lectures || []).find(x => x.id === el.dataset.id); if (!l) return;
    const pg = derive().lecProg[l.id] || {};
    ui.modal = { type: 'lecture', id: l.id, f: { name: l.name || '', min: l.min || '', url: l.url || '', instructor: l.instructor || '', imp: l.imp || 2, notes: l.notes || '', cids: (l.conceptIds || []).filter(x => N(x) && !N(x).auto), prereq: (l.prereq || []).slice(),
      watch: !!l.watchedAt, study: !!l.studiedAt, recall: !!(l.recalledAt || pg.recall), practice: !!(l.practicedAt || pg.practice), done: !!l.doneAt } }; renderModal(); },
  'lec-c': el => { const f = ui.modal.f, id = el.dataset.id; f.cids = f.cids.includes(id) ? f.cids.filter(x => x !== id) : f.cids.concat(id); renderModal(); },
  'lec-pre': el => { const f = ui.modal.f, id = el.dataset.id; f.prereq = f.prereq.includes(id) ? f.prereq.filter(x => x !== id) : f.prereq.concat(id); renderModal(); },
  'lec-save': () => {
    const M = ui.modal, f = M.f, c = core(), l = c.lectures.find(x => x.id === M.id); if (!l) return;
    const now = Date.now(), auto = (l.conceptIds || []).filter(x => N(x) && N(x).auto);
    let list = renameLecture(c.lectures, l.id, f.name);
    list = updateLecture(list, l.id, { min: Math.max(0, Math.round(+f.min || 0)) || undefined, url: safeUrl(f.url) || undefined, instructor: f.instructor.trim() || undefined, imp: +f.imp || 2, notes: f.notes,
      conceptIds: f.cids.length ? f.cids : auto, prereq: f.prereq,
      watchedAt: f.watch ? l.watchedAt || now : null, studiedAt: f.study ? l.studiedAt || now : null, recalledAt: f.recall ? l.recalledAt || now : null, practicedAt: f.practice ? l.practicedAt || now : null, doneAt: f.done ? l.doneAt || now : null }, now);
    saveLectures(list, l.subjectId); ui.modal = null; render(); toast('Lecture saved.');
  },
  'lec-del': el => { const l = (core().lectures || []).find(x => x.id === el.dataset.id); if (!l) return;
    askConfirm({ title: 'Delete this lecture?', text: 'Sessions that mention it keep their time. Later lectures are renumbered.', yes: 'Delete', danger: true, fn: () => { saveLectures(removeLecture(core().lectures, l.id), l.subjectId); render(); } }); },
  'lec-step': el => { const c = core(), l = c.lectures.find(x => x.id === el.dataset.id); if (!l) return; const k = el.dataset.v, pg = derive().lecProg[l.id];
    const on = !(pg && pg[k]); const field = { watch: 'watchedAt', study: 'studiedAt', recall: 'recalledAt', practice: 'practicedAt' }[k];
    if (!on && !l[field]) { toast('That step counts from your recall or practice of its concepts. Unlink concepts in the lecture to change it.'); return; }
    Object.assign(l, markStep(l, k, Date.now(), on)); Store.touch('core'); render(); },
  'lec-start': el => { const d = derive(), l = d.lectures.find(x => x.id === el.dataset.id); if (!l) return; const pg = d.lecProg[l.id];
    const next = pg.covered ? 'recall' : pg.next || 'watch';
    if (next === 'recall') { if ((l.conceptIds || []).length) { beginReview(l.conceptIds.slice(), { mixed: false }); go('review'); } else openLectureRecall(l.id); return; }
    openStart({ subjectId: l.subjectId, topicId: l.topicId || '', conceptIds: (l.conceptIds || []).slice(), mode: next === 'watch' ? 'lecture' : next === 'practice' ? 'practice' : 'reading', style: 'focus', minutes: next === 'watch' ? l.min || core().prep.defaultLectureMin : Math.max(10, Math.round((l.min || core().prep.defaultLectureMin) * core().prep.selfStudyRatio)), lectureId: l.id, taskKind: next === 'watch' ? 'lecture' : 'selfstudy' }); },
  'lrec-grade': el => { const M = ui.modal, c = core(), l = c.lectures.find(x => x.id === M.id); if (!l) { ui.modal = null; render(); return; }
    const g = +el.dataset.v; if (g >= 2) Object.assign(l, markStep(l, 'recall', Date.now(), true)); l.recallNote = M.f.text || l.recallNote; l.updatedAt = Date.now(); Store.touch('core');
    const p = c.plan; if (M.blockKey && p) { p.done = p.done || {}; p.done[M.blockKey] = true; const b = p.blocks.find(x => x.key === M.blockKey); if (b) b.status = 'done'; }
    ui.modal = null; render(); toast(g >= 2 ? 'Recall logged for ' + derive().lecLab[l.id].code + '.' : 'Logged. Go through the lecture notes once more, then recall again tomorrow.'); },
  'res2-add': el => { const box = el.closest('.res-add'), q = k => (box && box.querySelector(`[data-r="${k}"]`)) || {};
    const title = (q('title').value || '').trim(), url = safeUrl(q('url').value), kind = q('kind').value || 'other';
    if (!title && !url) { toast('Add a title or a link.'); return; }
    const c = core(); c.resources = (c.resources || []).concat({ id: uid('rs'), kind, title: title || url, url: url || undefined, on: [{ kind: el.dataset.k, id: el.dataset.id }], createdAt: Date.now(), updatedAt: Date.now() });
    Store.touch('core'); if (ui.modal) renderModal(); else renderMain(); },
  'res2-del': el => { const c = core(), r = (c.resources || []).find(x => x.id === el.dataset.id); if (!r) return; Object.assign(r, { gone: true, updatedAt: Date.now() }); Store.touch('core'); if (ui.modal) renderModal(); else renderMain(); },
  // practice
  'prac-tab': el => { ui.pracTab = el.dataset.v; ui.qrev = null; renderMain(); },
  'q-new': el => openQuestion({ conceptId: el.dataset.cid || '', subjectId: el.dataset.sid || '' }),
  'q-open': el => editQuestion(el.dataset.id),
  'q-save': el => saveQuestionForm(el.dataset.v === 'more'),
  'q-del': el => { const id = el.dataset.id; askConfirm({ title: 'Delete this question?', text: 'Its attempts stay in your practice statistics.', yes: 'Delete', danger: true, fn: () => { removeQuestion(id); render(); } }); },
  'qrev-start': el => { const b = ui.qbuckets || buckets(), k = el.dataset.v; const ids = k === 'due' ? [...new Set(b.overdue.concat(b.dueToday))] : b[k] || []; if (!ids.length) return;
    if (!core().active) startSession({ mode: 'practice', style: 'focus', minutes: Math.max(10, ids.length * core().prep.minPerQuestion), conceptIds: [], subjectId: null, qids: ids });
    beginQuestionReview(ids); go('practice'); renderMain(); },
  'qrev-ids': el => { const ids = el.dataset.v.split(',').filter(Boolean); ui.modal = null; beginQuestionReview(ids); go('practice'); render(); },
  'qrev-reveal': () => { ui.qrev.shown = true; renderMain(); },
  'qrev-conf': el => { const R = ui.qrev, v = +el.dataset.v; R.f.conf = R.f.conf === v ? null : v; renderMain(); },
  'qrev-grade': el => { const R = ui.qrev; if (el.dataset.v === 'incorrect') { R.pending = 'incorrect'; renderMain(); return; } ACT['qrev-save'](el); },
  'qrev-mtype': el => { ui.qrev.f.mtype = el.dataset.v; renderMain(); },
  'qrev-undo': () => { ui.qrev.pending = null; renderMain(); },
  'qrev-save': el => { const R = ui.qrev, qid = R.queue[R.i], v = el.dataset.v;
    recordQuestionResult(qid, v, { timeSec: Math.round((Date.now() - R.shownAt) / 1000), confidence: R.f.conf, mtype: R.f.mtype, answer: R.f.answer, mode: 'review' });
    R.results.push(v);
    if (R.i + 1 >= R.queue.length && R.fromPlan) { const p = core().plan; if (p) { p.done = p.done || {}; p.done[R.fromPlan] = true; const b = p.blocks.find(x => x.key === R.fromPlan); if (b) b.status = 'done'; Store.touch('core'); } }
    nextQuestion(); },
  'qrev-close': () => { ui.qrev = null; renderMain(); }
};
export const CHG = {
  qfilter: el => { const f = ui.qf || (ui.qf = { sid: '', st: '', text: '' }); f[el.dataset.k] = el.value; renderMain(); },
  qsearch: el => { const f = ui.qf || (ui.qf = { sid: '', st: '', text: '' }); f.text = el.value; clearTimeout(ui.qsT); ui.qsT = setTimeout(() => { const pos = el.selectionStart; renderMain(); const i = document.querySelector('[data-c="qsearch"]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } }, 250); },
  'qrev-f': el => { if (ui.qrev) ui.qrev.f[el.dataset.k] = el.value; }
};
export const MODALS = {
  lecture: lectureModal,
  lrecall: lectureRecallModal,
  question: questionModal,
  'lec-titles'() {
    const M = ui.modal, n = lecturesOf(M.sid).length;
    return { html: `<div class="mhead"><h2>Lecture titles</h2><button class="x" data-a="close" aria-label="Close">×</button></div>
      <p class="small muted">One title per line, in lecture order. An empty line keeps just the code. ${plural(n, 'lecture')} in ${esc(subjName(M.sid))}.</p>
      <label class="f" style="max-width:180px">First line is lecture<input type="number" min="1" max="${n}" data-c="fv" data-k="start" value="${esc(M.f.start)}"></label>
      <textarea data-c="fv" data-k="text" rows="12">${esc(M.f.text)}</textarea>
      <div class="actions"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="lec-titles-save">Apply titles</button></div>` };
  }
};
