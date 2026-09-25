/* Logbook engine: pure functions shared by the browser UI and tests. No DOM, no network. */
/* =====================================================================
   ENGINE — pure functions, no DOM. Tested in Node before being inlined.
   ===================================================================== */
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sum = a => a.reduce((x, y) => x + y, 0);

/* ---------- study-day calendar (a "day" starts at dayStartHour, default 4 AM) ---------- */
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function dayKey(ts, sh) { return ymd(new Date(ts - (sh || 0) * HOUR)); }
function keyToDate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function dayStart(k, sh) { const d = keyToDate(k); d.setHours(sh || 0, 0, 0, 0); return d.getTime(); }
function addDays(k, n) { const d = keyToDate(k); d.setDate(d.getDate() + n); return ymd(d); }
function daysBetween(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / DAY); }
function weekStart(k) { const d = keyToDate(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
function monthStart(k) { return k.slice(0, 8) + '01'; }
function monthKeyOf(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function rangeKeys(a, b) { const out = []; let k = a; let guard = 0; while (k <= b && guard++ < 4000) { out.push(k); k = addDays(k, 1); } return out; }

function fmtDur(sec, withSec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h && m) return h + 'h ' + pad(m) + 'm';
  if (h) return h + 'h';
  if (m) return withSec && s ? m + 'm ' + pad(s) + 's' : m + 'm';
  return withSec ? s + 's' : (sec ? '<1m' : '0m');
}
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor((sec % 3600) / 60)) + ':' + pad(sec % 60);
}

/* =====================================================================
   MEMORY ENGINE — FSRS v4.5 formula structure with default weights.
   Informed by spacing/retrieval research; weights are NOT fitted to this
   student until enough reviews exist. Treat outputs as estimates.
   ===================================================================== */
const FSRS = {
  W: [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755],
  DECAY: -0.5,
  FACTOR: 19 / 81,
  R(elapsedDays, S) { return Math.pow(1 + this.FACTOR * elapsedDays / S, this.DECAY); },
  interval(S, r) { return S / this.FACTOR * (Math.pow(r, 1 / this.DECAY) - 1); },
  initS(g) { return Math.max(this.W[g - 1], 0.1); },
  initD(g) { return clamp(this.W[4] - (g - 3) * this.W[5], 1, 10); },
  nextD(D, g) { const d = D - this.W[6] * (g - 3); return clamp(this.W[7] * this.initD(4) + (1 - this.W[7]) * d, 1, 10); },
  sRecall(D, S, R, g) {
    const W = this.W, hard = g === 2 ? W[15] : 1, easy = g === 4 ? W[16] : 1;
    return S * (1 + Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * hard * easy);
  },
  sForget(D, S, R) {
    const W = this.W;
    return Math.min(S, W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)));
  }
};

const Memory = {
  recall(m, now) {
    if (!m || !m.S || !m.last) return null;
    return FSRS.R(Math.max(0, (now - m.last) / DAY), m.S);
  },
  targetRetention(base, importance) {
    let r = base || 0.9;
    if (importance === 3) r += 0.03; else if (importance === 1) r -= 0.05;
    return clamp(r, 0.75, 0.97);
  },
  /* Returns {S, D, R, ivl} for grade g without mutating m */
  step(m, g, now, opts) {
    const isNew = !m || !m.S;
    const elapsed = isNew ? 0 : Math.max(0, (now - m.last) / DAY);
    const R = isNew ? null : FSRS.R(elapsed, m.S);
    let S, D;
    if (isNew) { S = FSRS.initS(g); D = FSRS.initD(g); }
    else if (elapsed < 0.5) {
      // Same-day repeat: logged, can shorten after a failure, never lengthens the interval.
      D = FSRS.nextD(m.D, g);
      S = g === 1 ? Math.min(m.S, Math.max(FSRS.initS(1), m.S * 0.5)) : m.S;
    } else if (g === 1) { D = FSRS.nextD(m.D, g); S = FSRS.sForget(m.D, m.S, R); }
    else { D = FSRS.nextD(m.D, g); S = FSRS.sRecall(m.D, m.S, R, g); }
    S = clamp(S, 0.1, 36500);
    const ivl = Math.max(1, Math.round(FSRS.interval(S, opts.retention)));
    return { S, D, R, ivl, elapsed };
  },
  preview(m, now, opts) {
    const out = {};
    for (const g of [1, 2, 3, 4]) out[g] = this.step(m, g, now, opts).ivl;
    out[2] = Math.max(out[2], out[1]);
    out[3] = Math.max(out[3], out[2]);
    out[4] = Math.max(out[4], out[3] + 1);
    const cap = opts.maxIvl || 3650;
    for (const g of [1, 2, 3, 4]) out[g] = Math.min(out[g], cap);
    return out;
  },
  /* Apply a review. Returns the new memory record and a log entry. */
  apply(m0, g, now, opts) {
    const m = Object.assign({ reps: 0, lapses: 0, ok: 0, fail: 0 }, m0 || {});
    const st = this.step(m0, g, now, opts);
    const pv = this.preview(m0, now, opts);
    let ivl = pv[g];
    if (opts.fuzz && ivl > 7) ivl = Math.round(ivl * (0.95 + Math.random() * 0.1));
    ivl = Math.min(ivl, opts.maxIvl || 3650);
    const todayK = dayKey(now, opts.sh);
    const wasNew = !m.S;
    m.S = st.S; m.D = st.D; m.last = now;
    m.due = dayStart(addDays(todayK, ivl), opts.sh);
    m.ivl = ivl; m.reps++;
    if (g === 1) { m.fail++; if (!wasNew && st.elapsed >= 0.5) m.lapses++; m.state = 'relearning'; }
    else { m.ok++; m.state = 'review'; }
    if (!m.first) m.first = now;
    return { m, R: st.R, ivl, sameDay: !wasNew && st.elapsed < 0.5 };
  },
  suggestGrade({ outcome, hint, rtSec, conf }) {
    if (outcome === 'incorrect') return 1;
    if (outcome === 'partial' || hint) return 2;
    if (rtSec != null && rtSec <= 20 && (conf || 0) >= 4) return 4;
    if (rtSec != null && rtSec > 150) return 2;
    return 3;
  }
};

/* =====================================================================
   CONCEPT STATES + ESTIMATED MASTERY (product heuristics, documented)
   ===================================================================== */
const STATES = ['Not started', 'Exposed', 'Understood', 'Retrieved', 'Practiced', 'Applied', 'Stable', 'Mastered'];
const LEVEL_W = { basic: 0.8, standard: 1, advanced: 1.2, unfamiliar: 1.4 };
const OUT_SCORE = { correct: 1, partial: 0.5, incorrect: 0 };

function masteryOf(I, m, now) {
  const revs = I.reviews.slice(-10);
  const comps = [];
  if (revs.length) {
    let ws = 0, acc = 0;
    revs.forEach((r, i) => { const w = 0.6 + 0.4 * (i + 1) / revs.length; ws += w; acc += w * (r.o ? OUT_SCORE[r.o] : (r.g >= 2 ? 1 : 0)); });
    comps.push(['retrieval', acc / ws, 0.30]);
  }
  const pr = I.practice.slice(-15);
  const pn = sum(pr.map(p => p.n));
  if (pn > 0) {
    let wn = 0, wc = 0;
    pr.forEach(p => { const w = LEVEL_W[p.lv] || 1; wn += w * p.n; wc += w * p.c; });
    comps.push(['application', wc / wn, 0.25]);
  }
  const R = Memory.recall(m, now);
  if (R != null) {
    comps.push(['retention', R, 0.20]);
    comps.push(['stability', clamp(Math.log(1 + m.S) / Math.log(61), 0, 1), 0.15]);
  }
  const cr = revs.filter(r => r.cf);
  if (cr.length >= 3) {
    const err = sum(cr.map(r => Math.abs((r.cf - 1) / 4 - (r.o ? OUT_SCORE[r.o] : (r.g >= 2 ? 1 : 0))))) / cr.length;
    comps.push(['calibration', 1 - err, 0.10]);
  }
  const evidence = revs.length + pr.length;
  if (evidence < 2 || !comps.length) return { value: null, evidence, comps };
  const tw = sum(comps.map(c => c[2]));
  const value = sum(comps.map(c => c[1] * c[2])) / tw;
  return { value, evidence, level: evidence < 5 ? 'low' : evidence < 15 ? 'moderate' : 'good', comps };
}

function stateOf(I, m, now, mastery) {
  const touched = I.sessions.length || I.reviews.length || I.practice.length || (m && m.state);
  if (!touched) return 0;
  let st = 1;
  const lastConf = I.sessions.filter(s => s.confidenceAfter).slice(-1)[0];
  const lastTeach = I.teach.slice(-1)[0];
  if ((lastConf && lastConf.confidenceAfter >= 3) || (lastTeach && (lastTeach.score || 0) >= 60)) st = 2;
  const succ = I.reviews.filter(r => r.g >= 2 && r.o !== 'incorrect').length;
  if (succ >= 1) st = 3;
  const pn = sum(I.practice.map(p => p.n)), pc = sum(I.practice.map(p => p.c));
  if (pn > 0 && st >= 2) st = Math.max(st, 4);
  else if (pn >= 3) st = Math.max(st, 4);
  const applied = I.practice.some(p => (p.lv === 'advanced' || p.lv === 'unfamiliar') && p.n > 0 && p.c / p.n >= 0.6) || (pn >= 5 && pc / pn >= 0.7);
  if (applied && st >= 4) st = 5;
  const S = (m && m.S) || 0;
  if (st >= 4 && succ >= 3 && S >= 7) st = Math.max(st, 6);
  if (st >= 5 && succ >= 3 && S >= 21 && mastery && mastery.value >= 0.8) st = 7;
  return st;
}

function topicStatus(states) {
  if (!states.length || states.every(s => s === 0)) return 'Not started';
  const n = states.length, f = t => states.filter(s => s >= t).length / n;
  if (f(7) >= 0.8) return 'Mastered';
  if (f(6) >= 0.7) return 'Stable';
  if (f(4) >= 0.5) return 'Practicing';
  if (f(3) > 0) return 'Reviewing';
  return 'Learning';
}

/* =====================================================================
   TIME ANALYTICS — daily rollups (derived once, then summed per range)
   ===================================================================== */
const MODE_GROUP = {
  lecture: 'taking', reading: 'taking', revision: 'taking',
  notes: 'making', teachback: 'making', mistakes: 'making',
  recall: 'retrieving', practice: 'retrieving', mock: 'retrieving', mixed: 'mixed'
};

function splitOf(s) {
  if (s.split && s.split.length) return s.split;
  return [{ s: s.subjectId || null, t: s.topicId || null, c: null, sec: s.focusSec || 0 }];
}

function buildRollup(sessions, sh) {
  const days = {};
  for (const s of sessions) {
    if (s.status === 'discarded') continue;
    const k = dayKey(s.startedAt, sh);
    const d = days[k] || (days[k] = { sec: 0, timer: 0, manual: 0, imported: 0, paused: 0, n: 0, subj: {}, topic: {}, concept: {}, mode: {}, q: 0, qc: 0, longest: 0, hours: {} });
    const f = s.focusSec || 0;
    d.sec += f; d.n++;
    d[s.source === 'manual' ? 'manual' : s.source === 'imported' ? 'imported' : 'timer'] += f;
    d.paused += s.pausedSec || 0;
    d.longest = Math.max(d.longest, f);
    d.mode[s.mode] = (d.mode[s.mode] || 0) + f;
    d.q += s.questionsSolved || 0; d.qc += s.questionsCorrect || 0;
    const hr = new Date(s.startedAt).getHours();
    d.hours[hr] = (d.hours[hr] || 0) + f;
    for (const p of splitOf(s)) {
      const sid = p.s || '_none';
      d.subj[sid] = (d.subj[sid] || 0) + p.sec;
      if (p.t) d.topic[p.t] = (d.topic[p.t] || 0) + p.sec;
      if (p.u) d.topic[p.u] = (d.topic[p.u] || 0) + p.sec;
      if (p.c) d.concept[p.c] = (d.concept[p.c] || 0) + p.sec;
    }
  }
  return days;
}

function sumRange(days, a, b) {
  const out = { sec: 0, timer: 0, manual: 0, imported: 0, paused: 0, n: 0, subj: {}, topic: {}, concept: {}, mode: {}, q: 0, qc: 0, longest: 0, hours: {}, studyDays: 0, dayCount: 0 };
  for (const k of rangeKeys(a, b)) {
    out.dayCount++;
    const d = days[k]; if (!d) continue;
    if (d.sec >= 60) out.studyDays++;
    for (const f of ['sec', 'timer', 'manual', 'imported', 'paused', 'n', 'q', 'qc']) out[f] += d[f];
    out.longest = Math.max(out.longest, d.longest);
    for (const f of ['subj', 'topic', 'concept', 'mode', 'hours']) for (const x in d[f]) out[f][x] = (out[f][x] || 0) + d[f][x];
  }
  return out;
}

/* =====================================================================
   DAILY PLANNER — configurable heuristic, fits into available minutes
   ===================================================================== */
const DEFAULT_MIX = {
  early:  { review: 0.20, new: 0.45, practice: 0.25, mistakes: 0.05, cumulative: 0.05 },
  middle: { review: 0.25, new: 0.30, practice: 0.30, mistakes: 0.10, cumulative: 0.05 },
  final:  { review: 0.30, new: 0.05, practice: 0.35, mistakes: 0.15, cumulative: 0.15 }
};
const DEFAULT_WEIGHTS = { overdue: 3, risk: 4, importance: 2, prereq: 3, lapses: 1 };

function examPhase(daysLeft) {
  if (daysLeft == null) return 'middle';
  if (daysLeft > 180) return 'early';
  if (daysLeft > 60) return 'middle';
  return 'final';
}

function reviewPriority(item, w) {
  const R = item.R == null ? 0.5 : item.R;
  const od = clamp((item.overdueDays || 0) / Math.max(1, item.ivl || 1), 0, 3);
  return w.overdue * od + w.risk * (1 - R) * 10 + w.importance * (item.imp || 2) + w.prereq * (item.isPrereq ? 1 : 0) + w.lapses * Math.min(item.lapses || 0, 5);
}

/*
 ctx = { minutes, daysLeft, mix, minPerReview, due:[{cid,R,...,score}], newCands:[{cid,sid}], practiceCands:[{cid,sid}],
         mistakesDue:[{id,cid}], cumulativeCands:[{cid,sid}], lastStudyGapDays }
*/
function planDay(ctx) {
  const T = Math.max(0, Math.round(ctx.minutes || 0));
  const phase = examPhase(ctx.daysLeft);
  const mix = (ctx.mix && ctx.mix[phase]) || DEFAULT_MIX[phase];
  const mpr = ctx.minPerReview || 1.5;
  const blocks = [];
  const notes = [];
  if (T < 5) return { phase, blocks, notes: ['Nothing left to plan for today.'] };
  const due = ctx.due.slice().sort((a, b) => b.score - a.score);
  const backlog = ctx.lastStudyGapDays >= 3 || due.filter(d => d.overdueDays > 0).length > 15;
  if (backlog) notes.push('Welcome back. This plan starts with the reviews most at risk and keeps new learning small, so the backlog shrinks without piling up.');

  // Low-energy mode
  if (T <= 20) {
    const r = Math.min(due.length, 5);
    let left = T;
    if (r) { const m = Math.max(4, Math.min(8, Math.round(r * mpr))); blocks.push(mk('review', m, 'Micro recall', due.slice(0, r).map(d => d.cid))); left -= m; }
    if (ctx.formulaCands && ctx.formulaCands.length && left >= 7) { blocks.push(mk('cumulative', 3, 'Formula recall', ctx.formulaCands.slice(0, 2).map(c => c.cid))); left -= 3; }
    if (ctx.mistakesDue.length && left >= 6) { blocks.push(mk('mistakes', 4, 'One mistake retry', [ctx.mistakesDue[0].cid].filter(Boolean), [ctx.mistakesDue[0].id])); left -= 4; }
    if (left >= 5) {
      const c = ctx.newCands[0] || ctx.practiceCands[0];
      if (c) { blocks.push(mk(ctx.newCands[0] ? 'new' : 'practice', left, ctx.newCands[0] ? 'One concept: read, then recall' : 'A few practice questions', [c.cid])); left = 0; }
    }
    if (left > 0) { if (blocks[0]) blocks[0].min += left; else blocks.push(mk('cumulative', left, 'Quick recall of anything you studied recently')); }
    blocks.forEach((b, i) => b.key = b.kind + i);
    return { phase, blocks, notes: notes.concat(['Short on time: a small dose of recall keeps memories alive.']), lowEnergy: true };
  }

  const alloc = {};
  for (const k in mix) alloc[k] = T * mix[k];
  const reviewNeed = Math.ceil(due.length * mpr);
  const move = (from, to, amt) => { const a = Math.min(alloc[from], amt); alloc[from] -= a; alloc[to] += a; };
  if (reviewNeed < alloc.review) move('review', phase === 'early' ? 'new' : 'practice', alloc.review - reviewNeed);
  else if (reviewNeed > alloc.review) {
    const cap = T * (backlog ? 0.55 : 0.4);
    const want = Math.min(reviewNeed, cap) - alloc.review;
    if (want > 0) { const a = Math.min(alloc.new * 0.7, want); move('new', 'review', a); if (want - a > 0) move('practice', 'review', Math.min(alloc.practice * 0.5, want - a)); }
  }
  if (!ctx.mistakesDue.length) move('mistakes', 'practice', alloc.mistakes);
  if (!ctx.newCands.length) move('new', ctx.practiceCands.length ? 'practice' : 'review', alloc.new);
  if (!ctx.practiceCands.length) move('practice', ctx.newCands.length ? 'new' : 'review', alloc.practice);
  if (!ctx.cumulativeCands.length) move('cumulative', ctx.newCands.length ? 'new' : 'practice', alloc.cumulative);
  if (!due.length && alloc.review > 0) move('review', ctx.newCands.length ? 'new' : 'practice', alloc.review);

  // Round to 5-minute units, keep total == T
  const keys = ['review', 'new', 'practice', 'mistakes', 'cumulative'];
  const r5 = {}; let tot = 0;
  keys.forEach(k => { r5[k] = alloc[k] >= 2.5 ? Math.max(5, Math.round(alloc[k] / 5) * 5) : 0; tot += r5[k]; });
  let diff = T - tot;
  const biggest = keys.slice().sort((a, b) => r5[b] - r5[a])[0];
  r5[biggest] = Math.max(0, r5[biggest] + diff);
  if (r5[biggest] === 0) r5[biggest] = T;
  // Blocks shorter than 10 min are not useful for learning or practice: grow them or fold them in.
  for (const k of ['new', 'practice']) {
    if (r5[k] > 0 && r5[k] < 10 && T >= 30) {
      const donor = keys.filter(x => x !== k && r5[x] >= 15).sort((a, b) => r5[b] - r5[a])[0];
      if (donor) { r5[donor] -= 10 - r5[k]; r5[k] = 10; }
      else { const to = keys.filter(x => x !== k && r5[x] > 0).sort((a, b) => r5[b] - r5[a])[0]; if (to) { r5[to] += r5[k]; r5[k] = 0; } }
    }
  }

  const reviewItems = n => due.slice(0, Math.max(1, Math.floor(n / mpr))).map(d => d.cid);
  const pick = (arr, per, m) => arr.slice(0, Math.max(1, Math.round(m / per)));

  const made = {};
  if (r5.review) made.review = mk('review', r5.review, 'Review what is due', reviewItems(r5.review));
  if (r5.new) {
    const cs = pick(ctx.newCands, 30, r5.new);
    made.new = mk('new', r5.new, cs.length > 1 ? 'Learn ' + cs.length + ' new concepts' : 'Learn a new concept', cs.map(c => c.cid));
  }
  if (r5.practice) {
    const pc = pick(ctx.practiceCands, 15, r5.practice);
    const subjects = new Set(pc.map(c => c.sid));
    made.practice = mk('practice', r5.practice, subjects.size >= 2 && pc.length >= 3 ? 'Mixed practice' : 'Practice', pc.map(c => c.cid));
    made.practice.interleaved = subjects.size >= 2 && pc.length >= 3;
  }
  if (r5.mistakes) { const ms = ctx.mistakesDue.slice(0, Math.max(1, Math.floor(r5.mistakes / 5))); made.mistakes = mk('mistakes', r5.mistakes, 'Retry past mistakes', ms.map(x => x.cid).filter(Boolean), ms.map(x => x.id)); }
  if (r5.cumulative) made.cumulative = mk('cumulative', r5.cumulative, 'Cumulative recall', pick(ctx.cumulativeCands, 2, r5.cumulative).map(c => c.cid));

  if (T >= 150) {
    // Long-study structure: deep study, break, recall, practice, break, new learning, cumulative
    const order = [];
    const nw = made.new;
    if (nw && nw.min >= 50) {
      const first = Math.round(nw.min * 0.6 / 5) * 5;
      order.push(Object.assign({}, nw, { min: first, title: 'Deep study', ids: nw.cids.slice(0, Math.ceil(nw.cids.length / 2)) }));
      order.push(mk('break', 10, 'Break'));
      if (made.review) order.push(made.review);
      if (made.practice) order.push(made.practice);
      order.push(mk('break', 10, 'Break'));
      order.push(Object.assign({}, nw, { key: nw.key + 'b', min: nw.min - first, title: 'New learning', cids: nw.cids.slice(Math.ceil(nw.cids.length / 2)).concat(nw.cids.length === 1 ? nw.cids : []) }));
    } else {
      if (nw) order.push(nw);
      order.push(mk('break', 10, 'Break'));
      if (made.review) order.push(made.review);
      if (made.practice) order.push(made.practice);
      order.push(mk('break', 10, 'Break'));
    }
    if (made.mistakes) order.push(made.mistakes);
    if (made.cumulative) order.push(made.cumulative);
    // No single block over an hour: split big ones into two parts.
    for (let i = 0; i < order.length; i++) {
      const b = order[i];
      if (b.kind !== 'break' && b.min > 60) {
        const a = Math.ceil(b.min / 2 / 5) * 5;
        const half = Math.ceil(b.cids.length / 2);
        order.splice(i, 1, Object.assign({}, b, { min: a, cids: b.cids.slice(0, half) || b.cids }), mk('break', 5, 'Short break'),
          Object.assign({}, b, { min: b.min - a, title: b.title + ' (part 2)', cids: b.cids.slice(half).length ? b.cids.slice(half) : b.cids }));
        i += 2;
      }
    }
    // breaks consume time: trim the largest non-break blocks
    let over = sum(order.map(b => b.min)) - T;
    while (over > 0) {
      const big = order.filter(b => b.kind !== 'break').sort((a, b) => b.min - a.min)[0];
      if (!big || big.min <= 5) break;
      const cut = Math.min(over, big.min - 5, 5); big.min -= cut; over -= cut;
    }
    order.forEach((b, i) => b.key = b.kind + i);
    return { phase, blocks: order.filter(b => b.min > 0), notes, long: true };
  }
  for (const k of keys) if (made[k] && made[k].min > 0) {
    const b = made[k];
    if (k === 'new' && b.min >= 40) blocks.push(...learnThenRecall(b));
    else blocks.push(b);
  }
  blocks.forEach((b, i) => b.key = b.kind + i);
  return { phase, blocks, notes };
}
// New learning is followed by a short recall of the same concepts; long blocks are split so none runs past an hour.
function learnThenRecall(b) {
  const parts = b.min > 60 ? Math.ceil(b.min / 55) : 1;
  const size = []; let left = b.min;
  for (let i = 0; i < parts; i++) { const m = i === parts - 1 ? left : Math.round(b.min / parts / 5) * 5; size.push(m); left -= m; }
  const out = [], n = b.cids.length;
  size.forEach((m, i) => {
    const cids = b.cids.slice(Math.round(i * n / parts), Math.round((i + 1) * n / parts)); const use = cids.length ? cids : (n ? [b.cids[i % n]] : []);
    const r = m >= 45 ? 10 : 5;
    out.push(mk('new', m - r, parts > 1 ? 'Learn: part ' + (i + 1) + ' of ' + parts : b.title, use));
    out.push(mk('review', r, 'Recall what you just learned', use));
  });
  return out;
}
function mk(kind, min, title, cids, mids) { return { kind, min, title, cids: cids || [], mids: mids || [] }; }

/* =====================================================================
   NATURAL-LANGUAGE STUDY LOG PARSER (offline fallback; AI refines it)
   ===================================================================== */
const STOP = new Set('i the a an of for and to in on at my me was did have has had studied study studying revised revise learned learn learnt about with from some today yesterday hours hour hrs hr minutes minute mins min h m last week this than then it its that session sessions topic concept subject around roughly approx approximately just only also more less'.split(' '));
const stem = w => w.replace(/(ing|es|s)$/, '').replace(/[^a-z0-9]/g, '');
const toks = s => (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w) && w.length > 1).map(stem).filter(Boolean);

function parseDuration(t) {
  t = t.toLowerCase();
  let m = 0, found = false;
  const hm = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  if (hm) { m += parseFloat(hm[1]) * 60; found = true; }
  const mm = t.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  if (mm) { m += parseInt(mm[1], 10); found = true; }
  if (!found) {
    if (/one and a half hours?|1 and a half hours?/.test(t)) { m = 90; found = true; }
    else if (/half an hour|half hour|30 min/.test(t)) { m = 30; found = true; }
    else if (/an hour|one hour/.test(t)) { m = 60; found = true; }
    else if (/two hours/.test(t)) { m = 120; found = true; }
  }
  return found ? Math.round(m) : null;
}
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseDate(t, todayK) {
  t = t.toLowerCase();
  if (/day before yesterday/.test(t)) return addDays(todayK, -2);
  if (/yesterday/.test(t)) return addDays(todayK, -1);
  if (/\btoday\b|this morning|tonight|this evening/.test(t)) return todayK;
  for (let i = 0; i < 7; i++) {
    if (new RegExp('\\b' + WEEKDAYS[i] + '\\b').test(t)) {
      const d = keyToDate(todayK); let back = (d.getDay() - i + 7) % 7;
      if (back === 0 || /last\s+\w*day/.test(t)) back = back === 0 ? 7 : back;
      return addDays(todayK, -back);
    }
  }
  const md = t.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/) || t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})/);
  if (md) {
    const day = parseInt(isNaN(md[1]) ? md[2] : md[1], 10), mon = MONTHS.indexOf(isNaN(md[1]) ? md[1] : md[2]);
    const today = keyToDate(todayK); let y = today.getFullYear();
    const cand = new Date(y, mon, day); if (cand > today) y--;
    return ymd(new Date(y, mon, day));
  }
  return null;
}
function parseMode(t) {
  t = t.toLowerCase();
  const map = [[/mock/, 'mock'], [/teach|explain(ed)? it/, 'teachback'], [/mistake/, 'mistakes'], [/pyq|practi[cs]e|solved|problems|questions|numericals/, 'practice'],
    [/recall|flashcard|self-test|tested myself/, 'recall'], [/revis/, 'revision'], [/lecture|video|youtube|class/, 'lecture'], [/notes/, 'notes'], [/read|book|textbook|pdf/, 'reading']];
  for (const [re, m] of map) if (re.test(t)) return m;
  return null;
}
function matchNodes(text, nodes, byId) {
  const q = new Set(toks(text));
  if (!q.size) return null;
  let best = null;
  for (const n of nodes) {
    if (n.archived) continue;
    const nt = toks(n.name); if (!nt.length) continue;
    const hit = nt.filter(w => q.has(w)).length / nt.length;
    if (!hit) continue;
    let par = 0, p = byId[n.parentId], depth = 0;
    while (p && depth++ < 4) { const pt = toks(p.name); if (pt.some(w => q.has(w))) par += 1; p = byId[p.parentId]; }
    const kindBonus = n.kind === 'concept' ? 0.15 : n.kind === 'subtopic' ? 0.1 : n.kind === 'topic' ? 0.05 : 0;
    const score = hit * 0.7 + Math.min(par, 2) * 0.15 + kindBonus;
    if (!best || score > best.score) best = { node: n, score };
  }
  return best && best.score >= 0.5 ? best : null;
}
function parseStudyText(text, nodes, byId, todayK) {
  const r = { durationMin: parseDuration(text), dateKey: parseDate(text, todayK) || todayK, mode: parseMode(text) };
  const m = matchNodes(text, nodes, byId);
  if (m) {
    const chain = []; let n = m.node, g = 0;
    while (n && g++ < 6) { chain.unshift(n); n = byId[n.parentId]; }
    for (const x of chain) r[x.kind + 'Id'] = x.id;
    r.matchScore = m.score;
  }
  return r;
}

export { MIN, HOUR, DAY, pad, clamp, uid, sum, ymd, dayKey, keyToDate, dayStart, addDays, daysBetween, weekStart, monthStart, monthKeyOf, rangeKeys, fmtDur, fmtClock, FSRS, Memory, STATES, masteryOf, stateOf, topicStatus, MODE_GROUP, buildRollup, sumRange, splitOf, DEFAULT_MIX, DEFAULT_WEIGHTS, examPhase, reviewPriority, planDay, parseStudyText, parseDuration, parseDate, parseMode, toks , learnThenRecall };
