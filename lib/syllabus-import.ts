/*
 * Quick syllabus entry without any AI: JSON or an indented outline, previewed before anything is saved.
 *
 * JSON:    { "subject": "Physics", "topics": [ { "name": "Mechanics", "concepts": ["Newton's Laws"] } ] }
 *          (also an array of those, { "subjects": [...] }, subtopics, and concepts as { "name", "prereq": [names] })
 * Outline: Physics
 *            * Mechanics
 *              * Newton's Laws
 *          Top-level lines are subjects, then topics, then concepts. A third level under a second-level item makes
 *          that item a subtopic. Markdown headings (#, ##, ###) work too.
 */
import type { ID, Level3, SyllabusNode } from './types';

export type ImportConcept = { name: string; prereq?: string[] };
export type ImportTopic = { name: string; concepts: ImportConcept[]; subtopics: { name: string; concepts: ImportConcept[] }[] };
export type ImportSubject = { name: string; topics: ImportTopic[]; imp?: Level3; diff?: Level3; estHours?: number };
export type ImportTree = { subjects: ImportSubject[]; warnings: string[] };

const clean = (s: unknown) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const key = (s: string) => clean(s).toLowerCase();
const lvl = (v: unknown): Level3 | undefined => { const n = Number(v); return n === 1 || n === 2 || n === 3 ? n : undefined; };

function conceptOf(x: unknown): ImportConcept | null {
  if (typeof x === 'string') { const n = clean(x); return n ? { name: n } : null; }
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>; const n = clean(o.name ?? o.concept ?? o.title);
    if (!n) return null;
    const pre = Array.isArray(o.prereq) ? o.prereq.map(clean).filter(Boolean) : undefined;
    return pre && pre.length ? { name: n, prereq: pre } : { name: n };
  }
  return null;
}
function topicOf(x: unknown, warnings: string[]): ImportTopic | null {
  if (typeof x === 'string') { const n = clean(x); return n ? { name: n, concepts: [], subtopics: [] } : null; }
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>; const name = clean(o.name ?? o.topic ?? o.title);
  if (!name) { warnings.push('Skipped a topic without a name.'); return null; }
  const concepts = (Array.isArray(o.concepts) ? o.concepts : []).map(conceptOf).filter(Boolean) as ImportConcept[];
  const subtopics = (Array.isArray(o.subtopics) ? o.subtopics : []).map(s => {
    const t = topicOf(s, warnings); return t ? { name: t.name, concepts: t.concepts.concat(t.subtopics.flatMap(u => u.concepts)) } : null;
  }).filter(Boolean) as ImportTopic['subtopics'];
  return { name, concepts, subtopics };
}
function subjectOf(x: unknown, warnings: string[]): ImportSubject | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>; const name = clean(o.subject ?? o.name ?? o.title);
  if (!name) { warnings.push('Skipped a subject without a name.'); return null; }
  const topics = (Array.isArray(o.topics) ? o.topics : []).map(t => topicOf(t, warnings)).filter(Boolean) as ImportTopic[];
  if (Array.isArray(o.concepts) && o.concepts.length) topics.push({ name: 'General', concepts: o.concepts.map(conceptOf).filter(Boolean) as ImportConcept[], subtopics: [] });
  const s: ImportSubject = { name, topics };
  const imp = lvl(o.importance ?? o.imp), diff = lvl(o.difficulty ?? o.diff), h = Number(o.hours ?? o.estHours);
  if (imp) s.imp = imp; if (diff) s.diff = diff; if (isFinite(h) && h > 0) s.estHours = h;
  return s;
}

export function parseSyllabusJSON(input: unknown): ImportTree {
  const warnings: string[] = [];
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch (e) { throw new Error('That is not valid JSON: ' + ((e as Error).message || 'parse error')); }
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { subjects?: unknown }).subjects) ? (data as { subjects: unknown[] }).subjects : [data];
  const subjects = list.map(x => subjectOf(x, warnings)).filter(Boolean) as ImportSubject[];
  if (!subjects.length) throw new Error('No subjects found. Use { "subject": "Name", "topics": [...] }.');
  return { subjects, warnings };
}

export function parseSyllabusOutline(text: string, opts: { subjectName?: string } = {}): ImportTree {
  const warnings: string[] = [];
  type Row = { depth: number; name: string };
  const rows: Row[] = [];
  let base = -1;                       // depth of the last heading (or top-level plain line)
  let stack: number[] = [];            // indents seen under that heading
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    const indent = (/^[ \t]*/.exec(raw) as RegExpExecArray)[0].replace(/\t/g, '    ').length;
    const body = raw.trim();
    const h = /^(#{1,6})\s+(.*)$/.exec(body);
    if (h) { const d = h[1].length - 1; rows.push({ depth: d, name: clean(h[2]) }); base = d; stack = []; continue; }
    const bullet = /^([-*•+]|\d+[.)])\s+/.exec(body);
    const name = clean(bullet ? body.slice(bullet[0].length) : body);
    if (!name) continue;
    if (!bullet && indent === 0) { rows.push({ depth: 0, name }); base = 0; stack = []; continue; }
    while (stack.length && stack[stack.length - 1] > indent) stack.pop();
    if (!stack.length || stack[stack.length - 1] < indent) stack.push(indent);
    rows.push({ depth: base + 1 + stack.length - 1, name });
  }
  if (!rows.length) throw new Error('Nothing to import. Put each subject on its own line and indent topics and concepts under it.');
  const subjects: ImportSubject[] = [];
  let s: ImportSubject | null = null, t: ImportTopic | null = null, pending: { name: string; kids: ImportConcept[] } | null = null;
  const flush = () => { if (pending && t) { if (pending.kids.length) t.subtopics.push({ name: pending.name, concepts: pending.kids }); else t.concepts.push({ name: pending.name }); } pending = null; };
  const needSubject = () => {
    if (!s) { s = { name: clean(opts.subjectName) || 'Imported subject', topics: [] }; subjects.push(s); if (!opts.subjectName) warnings.push('The outline did not start with a subject, so its items went under "Imported subject".'); }
    return s;
  };
  const needTopic = () => { const sub = needSubject(); if (!t) { t = { name: 'General', concepts: [], subtopics: [] }; sub.topics.push(t); } return t; };
  let flattened = 0;
  for (const r of rows) {
    if (r.depth <= 0) { flush(); s = { name: r.name, topics: [] }; subjects.push(s); t = null; }
    else if (r.depth === 1) { flush(); t = { name: r.name, concepts: [], subtopics: [] }; needSubject().topics.push(t); }
    else if (r.depth === 2) { flush(); needTopic(); pending = { name: r.name, kids: [] }; }
    else { needTopic(); if (!pending) pending = { name: 'General', kids: [] }; if (r.depth > 3) flattened++; pending.kids.push({ name: r.name }); }
  }
  flush();
  if (flattened) warnings.push(flattened + ' item' + (flattened > 1 ? 's were' : ' was') + ' nested deeper than concepts and became concepts of the nearest subtopic.');
  return { subjects, warnings };
}

/** JSON if it looks like JSON, otherwise an outline. */
export function parseSyllabus(text: string, opts: { subjectName?: string } = {}): ImportTree {
  const t = String(text || '').trim();
  return /^[[{]/.test(t) ? parseSyllabusJSON(t) : parseSyllabusOutline(t, opts);
}

/* ------------------------------------------------------------------ preview and apply */

export type ImportPreview = { subjects: { name: string; existing: boolean; topics: number; subtopics: number; concepts: number; skipped: number }[];
  totals: { subjects: number; topics: number; subtopics: number; concepts: number; skipped: number }; warnings: string[] };

type Idx = { byParent: Map<string, Map<string, SyllabusNode>> };
function index(nodes: SyllabusNode[]): Idx {
  const byParent = new Map<string, Map<string, SyllabusNode>>();
  for (const n of nodes) { if (n.archived) continue; const p = n.parentId || '_'; if (!byParent.has(p)) byParent.set(p, new Map()); byParent.get(p)!.set(n.kind + ':' + key(n.name), n); }
  return { byParent };
}

type IdFn = (prefix: string) => string;
const defaultId: IdFn = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * Merges the tree into the syllabus: subjects, topics and concepts that already exist (same name, same parent)
 * are reused, never duplicated. Returns the new node list and what was added. Pure: the input list is not changed.
 */
export function applyImport(tree: ImportTree, nodes: SyllabusNode[], opts: { examId?: ID | null; palette?: string[]; now?: number; id?: IdFn; dryRun?: boolean } = {}):
  { nodes: SyllabusNode[]; preview: ImportPreview; added: SyllabusNode[] } {
  const now = opts.now ?? Date.now(), id = opts.id || defaultId, palette = opts.palette || ['#2447C8'];
  const out = nodes.slice(), added: SyllabusNode[] = [], idx = index(nodes);
  const preview: ImportPreview = { subjects: [], totals: { subjects: 0, topics: 0, subtopics: 0, concepts: 0, skipped: 0 }, warnings: tree.warnings.slice() };
  const nextOrder = (parent: string | null) => { const sib = out.filter(n => (n.parentId || null) === parent); return sib.length ? Math.max(...sib.map(n => n.order || 0)) + 1 : 0; };
  const find = (parent: string, kind: SyllabusNode['kind'], name: string) => { const m = idx.byParent.get(parent); return m ? m.get(kind + ':' + key(name)) : undefined; };
  const put = (n: SyllabusNode) => { out.push(n); added.push(n); const p = n.parentId || '_'; if (!idx.byParent.has(p)) idx.byParent.set(p, new Map()); idx.byParent.get(p)!.set(n.kind + ':' + key(n.name), n); return n; };
  const nameToConcept = new Map<string, SyllabusNode>();
  for (const n of nodes) if (n.kind === 'concept' && !n.archived) nameToConcept.set(key(n.name), n);
  const prereqs: { node: SyllabusNode; names: string[] }[] = [];
  let subjectCount = out.filter(n => n.kind === 'subject').length;
  for (const is of tree.subjects) {
    const row = { name: is.name, existing: false, topics: 0, subtopics: 0, concepts: 0, skipped: 0 };
    let sub = find('_', 'subject', is.name);
    if (sub) row.existing = true;
    else {
      sub = put({ id: id('s'), kind: 'subject', parentId: null, name: is.name, order: nextOrder(null), examIds: opts.examId ? [opts.examId] : [],
        color: palette[subjectCount++ % palette.length], imp: is.imp || 2, diff: is.diff, estHours: is.estHours, createdAt: now });
      preview.totals.subjects++;
    }
    const addConcepts = (parent: SyllabusNode, list: ImportConcept[]) => {
      const seen = new Set<string>();
      for (const c of list) {
        if (seen.has(key(c.name)) || find(parent.id, 'concept', c.name)) { row.skipped++; continue; }
        seen.add(key(c.name));
        const n = put({ id: id('c'), kind: 'concept', parentId: parent.id, name: c.name, order: nextOrder(parent.id), createdAt: now });
        nameToConcept.set(key(c.name), n); row.concepts++;
        if (c.prereq && c.prereq.length) prereqs.push({ node: n, names: c.prereq });
      }
    };
    for (const it of is.topics) {
      let t = find(sub.id, 'topic', it.name);
      if (!t) { t = put({ id: id('t'), kind: 'topic', parentId: sub.id, name: it.name, order: nextOrder(sub.id), createdAt: now }); row.topics++; }
      addConcepts(t, it.concepts);
      for (const u of it.subtopics) {
        let st = find(t.id, 'subtopic', u.name);
        if (!st) { st = put({ id: id('u'), kind: 'subtopic', parentId: t.id, name: u.name, order: nextOrder(t.id), createdAt: now }); row.subtopics++; }
        addConcepts(st, u.concepts);
      }
    }
    preview.subjects.push(row);
    preview.totals.topics += row.topics; preview.totals.subtopics += row.subtopics; preview.totals.concepts += row.concepts; preview.totals.skipped += row.skipped;
  }
  let missing = 0;
  for (const p of prereqs) {
    const ids = p.names.map(nm => nameToConcept.get(key(nm))).filter(x => x && x.id !== p.node.id).map(x => x!.id);
    missing += p.names.length - ids.length;
    if (ids.length) p.node.prereq = [...new Set(ids)];
  }
  if (missing) preview.warnings.push(missing + ' prerequisite name' + (missing > 1 ? 's' : '') + ' did not match any concept and were left out.');
  if (preview.totals.skipped) preview.warnings.push(preview.totals.skipped + ' concept' + (preview.totals.skipped > 1 ? 's' : '') + ' already existed and will not be duplicated.');
  return { nodes: opts.dryRun ? nodes : out, preview, added: opts.dryRun ? [] : added };
}
export function previewImport(tree: ImportTree, nodes: SyllabusNode[]): ImportPreview {
  return applyImport(tree, nodes, { dryRun: true, id: p => p + 'preview' + Math.random() }).preview;
}
