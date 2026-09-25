// @ts-nocheck
import { it, expect } from 'vitest';
import * as E from '../lib/engine.js';
const assert = (c: unknown, m: string) => it(m, () => expect(!!c).toBe(true));
const sh = 4, opts = { retention: 0.9, sh, maxIvl: 3650 };
// 1. FSRS progression: Good, Good, Good at due dates
let now = new Date(2026, 8, 1, 10).getTime(), m = null; const ivls = [];
for (let i = 0; i < 6; i++) { const r = E.Memory.apply(m, 3, now, opts); m = r.m; ivls.push(r.ivl); now = m.due + 5 * E.HOUR; }
console.log('   Good-streak intervals (days):', ivls.join(', '));
assert(ivls.every((x, i) => i === 0 || x > ivls[i - 1]), 'intervals grow with successive Good reviews');
assert(ivls[0] >= 3 && ivls[0] <= 5, 'first Good interval ≈ 4 days');
// 2. Lapse shrinks stability
const beforeS = m.S; const lap = E.Memory.apply(m, 1, now, opts);
assert(lap.m.S < beforeS && lap.m.lapses === 1, 'Again after long interval shrinks stability & counts a lapse (S ' + beforeS.toFixed(1) + ' → ' + lap.m.S.toFixed(1) + ')');
// 3. preview ordering
const pv = E.Memory.preview(m, now, opts);
assert(pv[1] <= pv[2] && pv[2] <= pv[3] && pv[3] < pv[4], 'preview intervals ordered Again≤Hard≤Good<Easy: ' + JSON.stringify(pv));
// 4. same-day repeat doesn't lengthen
const r1 = E.Memory.apply(null, 3, now, opts); const r2 = E.Memory.apply(r1.m, 4, now + 2 * E.HOUR, opts);
assert(r2.m.S === r1.m.S && r2.sameDay, 'same-day Easy does not inflate stability');
// 5. exam cap
const capped = E.Memory.preview(m, now, Object.assign({}, opts, { maxIvl: 10 }));
assert(Math.max(...Object.values(capped)) <= 10, 'exam-aware cap limits intervals');
// 6. recall decays
const R0 = E.Memory.recall(m, m.last), R30 = E.Memory.recall(m, m.last + 30 * E.DAY);
assert(R0 > 0.99 && R30 < R0, 'estimated recall decays with time (' + R30.toFixed(2) + ' after 30d)');

// 7. Multi-subject, multi-session day rollup + study-day boundary at 4 AM
const t = (d, h, mi) => new Date(2026, 8, d, h, mi).getTime();
const S = (sid, a, b, extra = {}) => Object.assign({ id: E.uid('s'), subjectId: sid, startedAt: a, endedAt: b, focusSec: (b - a) / 1000, source: 'timer', mode: 'learn', status: 'stopped' }, extra);
const sessions = [
  S('math', t(25, 8, 0), t(25, 9, 0)), S('mach', t(25, 10, 30), t(25, 11, 20)), S('ps', t(25, 14, 0), t(25, 15, 15)), S('ga', t(25, 18, 0), t(25, 18, 45)),
  S('mach', t(26, 1, 0), t(26, 1, 30)),            // 1 AM → still Sept 25 study-day
  S('ps', t(24, 9, 0), t(24, 10, 0), { source: 'manual' }),
  S('math', t(25, 20, 0), t(25, 20, 30), { status: 'discarded' })
];
const days = E.buildRollup(sessions, sh);
assert(Math.round(days['2026-09-25'].sec / 60) === 260, 'Sept 25 total = 4h 20m incl. 1 AM session (got ' + E.fmtDur(days['2026-09-25'].sec) + ')');
assert(days['2026-09-25'].n === 5 && !days['2026-09-26'], '5 sessions on one study-day; discarded excluded');
assert(days['2026-09-25'].subj.mach === 80 * 60, 'Machines = 1h 20m across two sessions');
const wk = E.sumRange(days, '2026-09-21', '2026-09-27');
assert(wk.manual === 3600 && wk.timer === 260 * 60, 'time audit separates timer vs manual');

// 8. Planner: respects minutes, low-energy, long mode, missed-day
const cands = n => Array.from({ length: n }, (_, i) => ({ cid: 'c' + i, sid: 's' + (i % 3) }));
const due = Array.from({ length: 30 }, (_, i) => ({ cid: 'd' + i, R: 0.6 + i / 100, overdueDays: i % 4, ivl: 5, score: 50 - i }));
const base = { daysLeft: 134, minPerReview: 1.5, due, newCands: cands(5), practiceCands: cands(6), mistakesDue: [{ id: 'm1', cid: 'c1' }], cumulativeCands: cands(8), formulaCands: cands(2), lastStudyGapDays: 0 };
for (const minutes of [15, 30, 90, 180]) {
  const p = E.planDay(Object.assign({}, base, { minutes }));
  const total = p.blocks.reduce((a, b) => a + b.min, 0);
  console.log('   ' + minutes + ' min →', p.blocks.map(b => b.title + ' ' + b.min + 'm').join(' | '));
  assert(total === minutes, 'plan for ' + minutes + ' min sums exactly to ' + minutes + ' (got ' + total + ')');
}
const back = E.planDay(Object.assign({}, base, { minutes: 60, lastStudyGapDays: 6, due: Array.from({ length: 80 }, (_, i) => ({ cid: 'd' + i, R: 0.5, overdueDays: 5, ivl: 3, score: 80 - i })) }));
const rv = back.blocks.find(b => b.kind === 'review');
assert(back.notes.length && rv && rv.min <= 35 && rv.cids.length < 80, 'missed-day recovery caps review load (' + rv.min + 'm, ' + rv.cids.length + ' of 80 cards) and shows a note');
const empty = E.planDay(Object.assign({}, base, { minutes: 60, due: [], newCands: [], practiceCands: [], mistakesDue: [], cumulativeCands: [] }));
assert(empty.blocks.reduce((a, b) => a + b.min, 0) === 60, 'plan still sums correctly with an empty syllabus');

// 9. NL parser
const nodes = [
  { id: 'em', kind: 'subject', name: 'Electrical Machines' }, { id: 'tr', kind: 'topic', name: 'Transformers', parentId: 'em' },
  { id: 'vr', kind: 'concept', name: 'Voltage regulation', parentId: 'tr' }, { id: 'eff', kind: 'concept', name: 'Efficiency and all-day efficiency', parentId: 'tr' },
  { id: 'ps', kind: 'subject', name: 'Power Systems' }, { id: 'fa', kind: 'topic', name: 'Fault analysis', parentId: 'ps' }, { id: 'vreg', kind: 'concept', name: 'Voltage and frequency control', parentId: 'ps' }];
const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
const p1 = E.parseStudyText('I studied Transformer voltage regulation for 45 minutes.', nodes, byId, '2026-09-25');
assert(p1.conceptId === 'vr' && p1.subjectId === 'em' && p1.durationMin === 45, 'parses "Transformer voltage regulation for 45 minutes"');
const p2 = E.parseStudyText('did fault analysis yesterday for 1.5 hours solving PYQs', nodes, byId, '2026-09-25');
assert(p2.topicId === 'fa' && p2.durationMin === 90 && p2.dateKey === '2026-09-24' && p2.mode === 'practice', 'parses topic + yesterday + 1.5 h + practice');
const p3 = E.parseStudyText('studied power systems on Sept 20 for 1h 30m', nodes, byId, '2026-09-25');
assert(p3.subjectId === 'ps' && p3.dateKey === '2026-09-20' && p3.durationMin === 90, 'parses "Sept 20" and "1h 30m"');
const p4 = E.parseStudyText('last monday 2 hours machines', nodes, byId, '2026-09-25');
assert(p4.dateKey === '2026-09-21' && p4.durationMin === 120, 'parses "last monday"');

// 10. Mastery / state ladder
const I = { sessions: [{ confidenceAfter: 4 }], reviews: [], practice: [], teach: [] };
assert(E.stateOf(I, null, now, null) === 2, 'session + confidence → Understood (not mastered)');
const I2 = { sessions: [{}], reviews: [{ g: 3, o: 'correct' }, { g: 3, o: 'correct' }, { g: 3, o: 'correct', cf: 4 }], practice: [{ n: 6, c: 5, lv: 'unfamiliar' }], teach: [] };
const mm = { S: 25, D: 5, last: now };
const mast = E.masteryOf(I2, mm, now);
console.log('   mastery sample:', mast.value.toFixed(2), mast.level);
assert(E.stateOf(I2, mm, now, mast) === 7, 'strong recall + unfamiliar-problem accuracy + S≥21 → Mastered');
const I3 = { sessions: [{}, {}, {}, {}, {}], reviews: [], practice: [], teach: [] };
assert(E.stateOf(I3, null, now, null) === 1 && E.masteryOf(I3, null, now).value === null, 'hours of study alone never create mastery (stays Exposed, mastery = not enough data)');

// 11. New learning is followed by recall and never runs past an hour in one block
const fresh = E.planDay(Object.assign({}, base, { minutes: 120, due: [], practiceCands: [], mistakesDue: [], cumulativeCands: [], newCands: cands(4) }));
assert(fresh.blocks.reduce((a, b) => a + b.min, 0) === 120 && fresh.blocks.every(b => b.min <= 60), 'first-day 120 min plan sums to 120 with no block over an hour');
assert(fresh.blocks.some((b, i) => b.kind === 'new' && fresh.blocks[i + 1] && fresh.blocks[i + 1].kind === 'review' && fresh.blocks[i + 1].cids.join() === b.cids.join()), 'each learning block is followed by recall of the same concepts');
