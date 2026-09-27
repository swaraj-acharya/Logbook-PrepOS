// @ts-nocheck
import { describe, it, expect } from 'vitest';
import * as L from '../lib/lectures';

let n = 0; const id = p => p + (++n);
const now = new Date(2026, 8, 27, 10).getTime();

describe('lectures', () => {
  it('generates L01, L02 … with stable ids and no stored names', () => {
    const ls = L.generateLectures('math', 12, { id, now, min: 50 });
    const lab = L.lectureLabels(ls);
    expect(ls.map(l => lab[l.id].code).slice(0, 3)).toEqual(['L01', 'L02', 'L03']);
    expect(lab[ls[11].id].code).toBe('L12');
    expect(ls.every(l => l.name === '' && l.min === 50)).toBe(true);
    expect(new Set(ls.map(l => l.id)).size).toBe(12);
    const big = L.lectureLabels(L.generateLectures('p', 120, { id, now }));
    expect(Object.values(big).map(x => x.code)).toContain('L007');
  });
  it('renames without touching the id, and typing a bare code keeps it automatic', () => {
    let ls = L.generateLectures('math', 3, { id, now });
    const first = ls[0].id;
    ls = L.renameLecture(ls, first, 'Introduction to Limits');
    expect(ls[0].id).toBe(first);
    expect(L.lectureLabels(ls)[first].label).toBe('L01 Introduction to Limits');
    ls = L.renameLecture(ls, first, 'L01');
    expect(ls[0].name).toBe('');
  });
  it('inserts between L05 and L06: ids stay, codes renumber, titles follow their lecture', () => {
    let ls = L.generateLectures('phy', 20, { id, now });
    const l5 = L.subjectLectures(ls, 'phy')[4], l6 = L.subjectLectures(ls, 'phy')[5];
    ls = L.renameLecture(ls, l6.id, 'Continuity');
    const r = L.insertLecture(ls, 'phy', l5.id, { name: 'Squeeze theorem' }, { id, now });
    const lab = L.lectureLabels(r.lectures);
    expect(L.subjectLectures(r.lectures, 'phy').length).toBe(21);
    expect(lab[r.lecture.id].code).toBe('L06');
    expect(lab[l6.id].label).toBe('L07 Continuity');
    expect(lab[l5.id].code).toBe('L05');
    const atStart = L.insertLecture(r.lectures, 'phy', null, {}, { id, now });
    expect(L.lectureLabels(atStart.lectures)[atStart.lecture.id].code).toBe('L01');
  });
  it('moves and removes lectures, keeping a tombstone', () => {
    let ls = L.generateLectures('c', 4, { id, now });
    const [a, b] = L.subjectLectures(ls, 'c');
    ls = L.moveLecture(ls, b.id, -1);
    expect(L.subjectLectures(ls, 'c')[0].id).toBe(b.id);
    ls = L.removeLecture(ls, a.id);
    expect(L.subjectLectures(ls, 'c').length).toBe(3);
    expect(ls.find(x => x.id === a.id).gone).toBe(true);
    expect(L.lectureLabels(ls)[L.subjectLectures(ls, 'c')[2].id].code).toBe('L03');
  });
  it('counts a lecture as covered only after watching plus self-study or recall, or when marked by hand', () => {
    const base = L.generateLectures('s', 1, { id, now })[0];
    expect(L.lectureProgress(base)).toMatchObject({ status: 'todo', next: 'watch', covered: false });
    const w = L.markStep(base, 'watch', now);
    expect(L.lectureProgress(w)).toMatchObject({ status: 'in-progress', next: 'study', covered: false });
    expect(L.lectureProgress(L.markStep(w, 'study', now + 1)).covered).toBe(true);
    expect(L.lectureProgress(w, { recalledAt: now + 5 }).covered).toBe(true);           // recall of its concepts counts
    expect(L.lectureProgress(w, { recalledAt: now - 5 }).covered).toBe(false);          // but not from before watching
    expect(L.lectureProgress(L.markStep(base, 'done', now)).covered).toBe(true);        // manual completion
  });
  it('tracks pace, projected completion and lag behind the roadmap baseline', () => {
    const day = 86400000;
    let ls = L.generateLectures('m', 10, { id, now, min: 60 });
    const sub = L.subjectLectures(ls, 'm');
    ls = ls.map((l, i) => i < 4 ? { ...l, watchedAt: now - (8 - i) * day, studiedAt: now - (8 - i) * day + 3600000 } : l);
    const baseline = { lectures: Object.fromEntries(sub.map((l, i) => [l.id, '2026-09-' + String(15 + i).padStart(2, '0')])) };
    const st = L.lectureStats(ls, '2026-09-27', { baseline });
    expect(st.total).toBe(10); expect(st.done).toBe(4); expect(st.remaining).toBe(6);
    expect(st.pct).toBeCloseTo(0.4); expect(st.remainingMin).toBe(360); expect(st.avgMin).toBe(60);
    expect(st.perDay14).toBeCloseTo(4 / 14);
    expect(st.projectedEnd).toBe('2026-10-18');
    expect(st.expectedDone).toBe(10); expect(st.behindLectures).toBe(6);
    expect(st.behindDays).toBe(8);   // L05 was due on 19 Sep
  });
  it('creates a recallable concept per lecture in a subject without concepts, and keeps names in step', () => {
    const nodes = [{ id: 'S', kind: 'subject', name: 'Programming', order: 0 }];
    let ls = L.generateLectures('S', 3, { id, now });
    let r = L.syncAutoConcepts(nodes, ls, 'S', { id, now });
    expect(r.created).toBe(3);
    const concepts = r.nodes.filter(x => x.kind === 'concept');
    expect(concepts.map(c => c.name)).toEqual(['L01', 'L02', 'L03']);
    expect(r.lectures.every(l => l.conceptIds.length === 1)).toBe(true);
    const renamed = L.renameLecture(r.lectures, r.lectures[0].id, 'C++ Basics');
    const r2 = L.syncAutoConcepts(r.nodes, renamed, 'S', { id, now });
    expect(r2.nodes.find(x => x.lectureId === r.lectures[0].id).name).toBe('L01 C++ Basics');
    // subjects with their own concepts are left for the user to map
    const own = [{ id: 'T', kind: 'subject', name: 'Maths', order: 0 }, { id: 't', kind: 'topic', parentId: 'T', name: 'Calc', order: 0 }, { id: 'c', kind: 'concept', parentId: 't', name: 'Limits', order: 0 }];
    expect(L.syncAutoConcepts(own, L.generateLectures('T', 2, { id, now }), 'T', { id, now }).created).toBe(0);
  });
});
