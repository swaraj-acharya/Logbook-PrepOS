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
