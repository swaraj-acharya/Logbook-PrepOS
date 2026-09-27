// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { mergeDoc, unionById } from '../lib/merge.js';

describe('merging copies from two devices', () => {
  it('keeps sessions from both copies and the newest version of each', () => {
    const phone = { sessions: [{ id: 'a', focusSec: 60, updatedAt: 5 }, { id: 'p', focusSec: 900, updatedAt: 6 }], updatedAt: 10 };
    const laptop = { sessions: [{ id: 'a', focusSec: 120, updatedAt: 8 }, { id: 'l', focusSec: 1800, updatedAt: 7 }], updatedAt: 9 };
    const m = mergeDoc('ses-2026-09', phone, laptop);
    expect(m.sessions.map(s => s.id).sort()).toEqual(['a', 'l', 'p']);
    expect(m.sessions.find(s => s.id === 'a').focusSec).toBe(120);
    expect(m.updatedAt).toBe(10);
  });
  it('respects deletions recorded as tombstones', () => {
    const a = { items: [{ id: 'm1', gone: true, updatedAt: 20 }], updatedAt: 20 };
    const b = { items: [{ id: 'm1', q: 'old', updatedAt: 3 }], updatedAt: 3 };
    expect(mergeDoc('mis-2026-09', b, a).items).toEqual([{ id: 'm1', gone: true, updatedAt: 20 }]);
  });
  it('merges review memory per concept, preferring more reviews', () => {
    const a = { nodes: ['newer'], mem: { c1: { reps: 3, last: 10 }, c2: { reps: 1, last: 5 } }, updatedAt: 50 };
    const b = { nodes: ['older'], mem: { c1: { reps: 4, last: 12 }, c3: { reps: 2, last: 1 } }, updatedAt: 40 };
    const m = mergeDoc('core', a, b);
    expect(m.nodes).toEqual(['newer']);
    expect(m.mem.c1.reps).toBe(4); expect(m.mem.c2.reps).toBe(1); expect(m.mem.c3.reps).toBe(2);
  });
  it('handles missing copies', () => {
    expect(mergeDoc('core', null, { a: 1 })).toEqual({ a: 1 });
    expect(unionById([], [{ id: 'x' }])).toEqual([{ id: 'x' }]);
  });
});

describe('merging new PrepOS documents', () => {
  it('merges question banks, question attempts and question memory item by item', () => {
    const a = { items: [{ id: 'q1', text: 'A', updatedAt: 5 }], updatedAt: 5 }, b = { items: [{ id: 'q2', text: 'B', updatedAt: 6 }], updatedAt: 6 };
    expect(mergeDoc('qs-2026-09', a, b).items.map(x => x.id).sort()).toEqual(['q1', 'q2']);
    const r1 = { reviews: [], practice: [], qattempts: [{ id: 'x', at: 1 }], updatedAt: 1 }, r2 = { reviews: [], practice: [], qattempts: [{ id: 'y', at: 2 }], updatedAt: 2 };
    expect(mergeDoc('rev-2026-09', r1, r2).qattempts.length).toBe(2);
    const c1 = { mem: {}, qmem: { q1: { reps: 3, last: 9 } }, updatedAt: 9 }, c2 = { mem: {}, qmem: { q1: { reps: 1, last: 3 }, q2: { reps: 1, last: 2 } }, updatedAt: 3 };
    const m = mergeDoc('core', c2, c1);
    expect(m.qmem.q1.reps).toBe(3); expect(m.qmem.q2.reps).toBe(1);
  });
  it('merges lectures per lecture and respects deleted lectures', () => {
    const phone = { mem: {}, lectures: [{ id: 'l1', name: 'Limits', watchedAt: 50, updatedAt: 50 }, { id: 'l2', gone: true, updatedAt: 60 }], updatedAt: 10 };
    const laptop = { mem: {}, lectures: [{ id: 'l1', name: '', updatedAt: 1 }, { id: 'l2', name: 'Old', updatedAt: 2 }, { id: 'l3', name: 'New', updatedAt: 30 }], updatedAt: 40 };
    const m = mergeDoc('core', phone, laptop);
    expect(m.lectures.find(l => l.id === 'l1').watchedAt).toBe(50);
    expect(m.lectures.find(l => l.id === 'l2').gone).toBe(true);
    expect(m.lectures.map(l => l.id).sort()).toEqual(['l1', 'l2', 'l3']);
  });
});
