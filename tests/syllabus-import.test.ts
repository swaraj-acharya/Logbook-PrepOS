// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { parseSyllabus, parseSyllabusJSON, parseSyllabusOutline, previewImport, applyImport } from '../lib/syllabus-import';

let n = 0; const id = p => p + (++n);

describe('syllabus import', () => {
  it('reads the documented JSON shape', () => {
    const t = parseSyllabusJSON('{"subject":"Physics","topics":[{"name":"Mechanics","concepts":["Newton\'s Laws","Work Energy Theorem"]}]}');
    expect(t.subjects).toEqual([{ name: 'Physics', topics: [{ name: 'Mechanics', concepts: [{ name: "Newton's Laws" }, { name: 'Work Energy Theorem' }], subtopics: [] }] }]);
    expect(() => parseSyllabusJSON('{nope')).toThrow(/not valid JSON/);
    expect(() => parseSyllabusJSON('{"topics":[]}')).toThrow();
  });
  it('reads an indented outline with bullets, including the loosely spaced example', () => {
    const t = parseSyllabusOutline(`Physics\n\n* Mechanics\n\n  * Newton's Laws\n  * Work Energy\n* Thermodynamics\n\n  * Laws of Thermodynamics\nChemistry\n- Organic\n  - Alkanes\n    - Naming\n    - Reactions`);
    expect(t.subjects.map(s => s.name)).toEqual(['Physics', 'Chemistry']);
    expect(t.subjects[0].topics.map(x => x.name)).toEqual(['Mechanics', 'Thermodynamics']);
    expect(t.subjects[0].topics[0].concepts.map(c => c.name)).toEqual(["Newton's Laws", 'Work Energy']);
    expect(t.subjects[1].topics[0].subtopics).toEqual([{ name: 'Alkanes', concepts: [{ name: 'Naming' }, { name: 'Reactions' }] }]);
  });
  it('accepts markdown headings and plain indentation', () => {
    const t = parseSyllabus('# Quant\n## Arithmetic\n- Percentages\n- Ratios\n# VARC\n  Reading\n    Inference');
    expect(t.subjects.map(s => s.name)).toEqual(['Quant', 'VARC']);
    expect(t.subjects[0].topics[0].concepts.length).toBe(2);
    expect(t.subjects[1].topics[0]).toMatchObject({ name: 'Reading', concepts: [{ name: 'Inference' }] });
  });
  it('previews first and merges without duplicating existing items', () => {
    const nodes = [{ id: 'S', kind: 'subject', name: 'Physics', order: 0 }, { id: 'T', kind: 'topic', parentId: 'S', name: 'Mechanics', order: 0 }, { id: 'C', kind: 'concept', parentId: 'T', name: "Newton's laws", order: 0 }];
    const tree = parseSyllabus(`Physics\n* Mechanics\n  * Newton's Laws\n  * Friction\nMaths\n* Algebra\n  * Matrices`);
    const pv = previewImport(tree, nodes);
    expect(pv.totals).toEqual({ subjects: 1, topics: 1, subtopics: 0, concepts: 2, skipped: 1 });
    expect(pv.subjects[0]).toMatchObject({ name: 'Physics', existing: true, concepts: 1, skipped: 1 });
    expect(nodes.length).toBe(3);                                              // preview changes nothing
    const r = applyImport(tree, nodes, { examId: 'e1', id, palette: ['#111', '#222'] });
    expect(r.nodes.length).toBe(3 + 4);
    expect(r.nodes.filter(x => x.kind === 'concept' && x.parentId === 'T').map(x => x.name)).toEqual(["Newton's laws", 'Friction']);
    expect(r.nodes.find(x => x.name === 'Maths')).toMatchObject({ kind: 'subject', examIds: ['e1'] });
  });
  it('links prerequisites given by name', () => {
    const tree = parseSyllabusJSON({ subject: 'Circuits', topics: [{ name: 'Analysis', concepts: ['KCL and KVL', { name: 'Node analysis', prereq: ['KCL and KVL', 'Unknown'] }] }] });
    const r = applyImport(tree, [], { id });
    const kcl = r.nodes.find(x => x.name === 'KCL and KVL'), node = r.nodes.find(x => x.name === 'Node analysis');
    expect(node.prereq).toEqual([kcl.id]);
    expect(r.preview.warnings.join(' ')).toMatch(/1 prerequisite name did not match/);
  });
});

describe('example syllabus file', () => {
  it('imports examples/gate-electrical-syllabus.json completely, with prerequisites resolved by name', async () => {
    const { readFileSync } = await import('node:fs');
    const tree = parseSyllabus(readFileSync(new URL('../examples/gate-electrical-syllabus.json', import.meta.url), 'utf8'));
    expect(tree.subjects.length).toBe(11); expect(tree.warnings).toEqual([]);
    const r = applyImport(tree, [], { examId: 'e1', id: p => p + Math.random().toString(36).slice(2) });
    const concepts = r.nodes.filter(n => n.kind === 'concept');
    expect(concepts.length).toBe(176);
    expect(concepts.filter(c => (c.prereq || []).length).length).toBeGreaterThan(10);
    expect(r.nodes.filter(n => n.kind === 'subject').every(s => (s.examIds || []).includes('e1'))).toBe(true);
  });
});
